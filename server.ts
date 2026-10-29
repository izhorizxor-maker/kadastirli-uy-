import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeMarkerColor,
  CADASTRAL_STATUS_LABELS,
  INSPECTION_STATUS_LABELS,
  type AuthUser,
  type CadastralStatus,
  type InspectionStatus,
  type MarkerColor,
  type ObjectType,
  type UserRole,
} from './src/types.ts';
import {
  createDatabaseBackup,
  getBackupFilePath,
  listDatabaseBackups,
  restoreDatabaseBackup,
  runSystemVerificationSuite,
} from './server/backup.ts';
import { createNotification, db, initializeDatabase, writeAuditLog } from './server/db.ts';
import {
  commitExcelPreview,
  generateReportsExcelBuffer,
  generateSampleExcelBuffer,
  previewExcelBuffer,
} from './server/excel.ts';
import {
  buildPropertyScopeClause,
  canUserAccessRegion,
  canUserConfirmOfficialCadastre,
  generateSessionToken,
  hashPassword,
  verifyPassword,
} from './server/security.ts';
import { UZBEKISTAN_DIRECTORY } from './server/uzbekistanRegions.ts';

dotenv.config();
initializeDatabase();

// Create an initial baseline backup if none exists yet so backup list is immediately ready
if (listDatabaseBackups().length === 0) {
  const adminRow = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get() as
    | AuthUser
    | undefined;
  if (adminRow) {
    createDatabaseBackup(adminRow);
  }
}

interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionToken?: string;
}

function getUserById(userId: number): AuthUser | undefined {
  return db
    .prepare(
      `
      SELECT
        u.id, u.username, u.full_name, u.role, u.phone, u.position,
        u.viloyat_id, u.tuman_id, u.mahalla_id, u.is_blocked, u.last_login_at, u.created_at,
        v.name as viloyat_name,
        t.name as tuman_name,
        m.name as mahalla_name
      FROM users u
      LEFT JOIN regions v ON v.id = u.viloyat_id
      LEFT JOIN regions t ON t.id = u.tuman_id
      LEFT JOIN regions m ON m.id = u.mahalla_id
      WHERE u.id = ?
    `
    )
    .get(userId) as AuthUser | undefined;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Avtorizatsiya talab qilinadi. Tizimga login va parol orqali kiring.' });
    return;
  }

  const token = authHeader.slice(7).trim();
  const session = db
    .prepare("SELECT token, user_id, expires_at FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .get(token) as { token: string; user_id: number; expires_at: string } | undefined;

  if (!session) {
    res.status(401).json({ error: 'Sessiya muddati tugagan yoki bekor qilingan. Qaytadan kiring.' });
    return;
  }

  const user = getUserById(session.user_id);
  if (!user || user.is_blocked) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.status(403).json({ error: 'Foydalanuvchi hisobi bloklangan yoki topilmadi.' });
    return;
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

function requireRoles(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Avtorizatsiya talab qilinadi.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      writeAuditLog({
        actor_id: req.user.id,
        actor_name: req.user.full_name,
        actor_role: req.user.role,
        action: 'UNAUTHORIZED_ACCESS_BLOCKED',
        entity_type: 'security',
        summary: `Ruxsatsiz murojaat rad etildi: ${req.method} ${req.originalUrl}`,
        ip_address: req.ip,
      });
      res.status(403).json({ error: 'Sizning rolingiz ushbu amalni bajarish huquqiga ega emas.' });
      return;
    }
    next();
  };
}

function enrichProperty(row: Record<string, any>) {
  return {
    ...row,
    marker_color: computeMarkerColor({
      cadastral_status: row.cadastral_status,
      latitude: row.latitude,
      longitude: row.longitude,
      location_verified: row.location_verified,
    }),
  };
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  // ============================================================================
  // 1. AUTHENTICATION & SECURITY (TZ Sections 3 & 4)
  // ============================================================================
  app.post('/api/auth/login', (req: Request, res: Response) => {
    try {
      const username = String(req.body?.username ?? '').trim();
      const password = String(req.body?.password ?? '');
      const ip = req.ip ?? '127.0.0.1';

      if (!username || !password) {
        res.status(400).json({ error: 'Login va parolni kiritish majburiy.' });
        return;
      }

      // Check rate-limit: max 5 failed attempts within last 5 minutes
      const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
      const recentFailures = db
        .prepare(
          'SELECT COUNT(*) as c FROM login_attempts WHERE username = ? AND succeeded = 0 AND attempted_at > ?'
        )
        .get(username.toLowerCase(), fiveMinsAgo) as { c: number };

      if (recentFailures.c >= 5) {
        writeAuditLog({
          actor_id: null,
          actor_name: username,
          actor_role: 'unauthenticated',
          action: 'LOGIN_LOCKED_OUT',
          entity_type: 'users',
          entity_id: username,
          summary: `"${username}" hisobiga ketma-ket noto‘g‘ri parol kiritilgani uchun vaqtinchalik cheklov qo‘llandi.`,
          ip_address: ip,
        });
        res.status(429).json({
          error:
            '5 marta noto‘g‘ri parol kiritildi. Xavfsizlik talabiga ko‘ra kirish 5 daqiqaga vaqtincha cheklandi.',
        });
        return;
      }

      const normalizedLogin = ['yuqori', 'yuqori_mfy', 'yuqori mahalla'].includes(
        username.trim().toLowerCase()
      )
        ? '0212010'
        : username.trim();

      const rawUser = db
        .prepare('SELECT id, username, password_hash, full_name, role, is_blocked FROM users WHERE LOWER(username) = LOWER(?)')
        .get(normalizedLogin) as
        | {
            id: number;
            username: string;
            password_hash: string;
            full_name: string;
            role: string;
            is_blocked: number;
          }
        | undefined;

      if (!rawUser || !verifyPassword(password, rawUser.password_hash)) {
        db.prepare(
          'INSERT INTO login_attempts (username, ip_address, succeeded, attempted_at) VALUES (?, ?, 0, ?)'
        ).run(username.toLowerCase(), ip, Date.now());

        writeAuditLog({
          actor_id: rawUser?.id ?? null,
          actor_name: username,
          actor_role: rawUser?.role ?? 'unknown',
          action: 'LOGIN_FAILED',
          entity_type: 'users',
          entity_id: username,
          summary: `Tizimga muvaffaqiyatsiz kirish urinishi: "${username}".`,
          ip_address: ip,
        });

        const remaining = Math.max(0, 5 - (recentFailures.c + 1));
        res.status(401).json({
          error: `Login yoki parol noto‘g‘ri. Qolgan urinishlar: ${remaining} ta.`,
        });
        return;
      }

      if (rawUser.is_blocked) {
        res.status(403).json({
          error: 'Ushbu foydalanuvchi akkaunti administrator tomonidan bloklangan.',
        });
        return;
      }

      // Reset failure counter & create session
      db.prepare('DELETE FROM login_attempts WHERE username = ? AND succeeded = 0').run(
        username.toLowerCase()
      );
      db.prepare(
        'INSERT INTO login_attempts (username, ip_address, succeeded, attempted_at) VALUES (?, ?, 1, ?)'
      ).run(username.toLowerCase(), ip, Date.now());

      const token = generateSessionToken();
      db.prepare(
        "INSERT INTO sessions (token, user_id, ip_address, created_at, expires_at) VALUES (?, ?, ?, datetime('now'), datetime('now', '+24 hours'))"
      ).run(token, rawUser.id, ip);

      db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(rawUser.id);

      const fullUser = getUserById(rawUser.id)!;
      writeAuditLog({
        actor_id: fullUser.id,
        actor_name: fullUser.full_name,
        actor_role: fullUser.role,
        action: 'USER_LOGIN',
        entity_type: 'sessions',
        entity_id: fullUser.username,
        summary: `${fullUser.full_name} (${fullUser.role}) tizimga kirdi.`,
        ip_address: ip,
      });

      res.json({ token, user: fullUser });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Server xatoligi yuz berdi.' });
    }
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res: Response) => {
    if (req.sessionToken) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    }
    if (req.user) {
      writeAuditLog({
        actor_id: req.user.id,
        actor_name: req.user.full_name,
        actor_role: req.user.role,
        action: 'USER_LOGOUT',
        entity_type: 'sessions',
        entity_id: req.user.username,
        summary: `${req.user.full_name} faol sessiyani yakunlab tizimdan chiqdi.`,
        ip_address: req.ip,
      });
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    const unread = db
      .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(req.user!.id) as { c: number };
    res.json({ user: req.user, unreadNotifications: unread.c });
  });

  // ============================================================================
  // 2. REGIONS (Viloyat, Tuman, Mahalla)
  // ============================================================================
  app.get('/api/regions', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const allRegions = db.prepare('SELECT * FROM regions ORDER BY level, name').all() as any[];

    if (user.role === 'admin') {
      res.json(allRegions);
      return;
    }
    if (user.role === 'inspector') {
      const filtered = allRegions.filter(
        (r) =>
          (r.level === 'viloyat' && r.id === user.viloyat_id) ||
          (r.level === 'tuman' && r.id === user.tuman_id) ||
          (r.level === 'mahalla' && r.parent_id === user.tuman_id)
      );
      res.json(filtered);
      return;
    }
    // Mahalla role: sees only their viloyat, tuman, and own mahalla
    const filtered = allRegions.filter(
      (r) =>
        (r.level === 'viloyat' && r.id === user.viloyat_id) ||
        (r.level === 'tuman' && r.id === user.tuman_id) ||
        (r.level === 'mahalla' && r.id === user.mahalla_id)
    );
    res.json(filtered);
  });

  app.post('/api/regions', requireAuth, requireRoles('admin'), (req: AuthedRequest, res: Response) => {
    try {
      const { name, level, parent_id, code, center_lat, center_lng, default_zoom } = req.body;
      if (!name || !level || !code) {
        res.status(400).json({ error: 'Hudud nomi, darajasi va kodi kiritilishi shart.' });
        return;
      }
      const lat = Number(center_lat ?? 40.7829);
      const lng = Number(center_lng ?? 72.3442);
      const zoom = Number(default_zoom ?? (level === 'mahalla' ? 17 : level === 'tuman' ? 14 : 11));

      const result = db
        .prepare(
          'INSERT INTO regions (name, level, parent_id, code, center_lat, center_lng, default_zoom) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          String(name).trim(),
          level,
          parent_id ? Number(parent_id) : null,
          String(code).trim().toUpperCase(),
          lat,
          lng,
          zoom
        );

      writeAuditLog({
        actor_id: req.user!.id,
        actor_name: req.user!.full_name,
        actor_role: req.user!.role,
        action: 'REGION_CREATED',
        entity_type: 'regions',
        entity_id: Number(result.lastInsertRowid),
        summary: `Yangi hudud kiritildi: ${name} (${level}, kod: ${code}).`,
        ip_address: req.ip,
      });

      const created = db
        .prepare('SELECT * FROM regions WHERE id = ?')
        .get(Number(result.lastInsertRowid));
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err.message?.includes('UNIQUE') ? 'Ushbu hudud kodi allaqachon mavjud.' : 'Hududni saqlashda xatolik.' });
    }
  });

  // ============================================================================
  // 3. DASHBOARD & REPORTS (Unique Object ID Deduplication — TZ Section 11)
  // ============================================================================
  app.get('/api/dashboard', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const scope = buildPropertyScopeClause(user, 'p');

    const stats = db
      .prepare(
        `
        SELECT
          COUNT(DISTINCT p.system_uid) as total_objects,
          COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed' AND p.latitude IS NOT NULL AND p.location_verified = 1 THEN p.system_uid END) as green_confirmed,
          COUNT(DISTINCT CASE WHEN p.cadastral_status = 'unverified' AND p.latitude IS NOT NULL AND p.location_verified = 1 THEN p.system_uid END) as yellow_needs_check,
          COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed_absent' AND p.latitude IS NOT NULL AND p.location_verified = 1 THEN p.system_uid END) as red_confirmed_absent,
          COUNT(DISTINCT CASE WHEN p.latitude IS NULL OR p.longitude IS NULL OR p.location_verified = 0 THEN p.system_uid END) as gray_unlocated,
          COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed' THEN p.system_uid END) as cad_confirmed,
          COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed_absent' THEN p.system_uid END) as cad_absent,
          COUNT(DISTINCT CASE WHEN p.cadastral_status = 'unverified' THEN p.system_uid END) as cad_unverified,
          COUNT(DISTINCT CASE WHEN p.inspection_status IN ('sent_for_inspection','assigned','in_progress','reopened') THEN p.system_uid END) as active_inspections,
          COUNT(DISTINCT CASE WHEN p.inspection_status = 'needs_info' THEN p.system_uid END) as needs_info_count,
          COUNT(DISTINCT CASE WHEN p.inspection_status = 'completed' THEN p.system_uid END) as completed_inspections,
          COUNT(DISTINCT CASE WHEN p.pending_lat IS NOT NULL THEN p.system_uid END) as pending_location_fixes
        FROM properties p
        WHERE ${scope.sql}
      `
      )
      .get(...scope.params) as Record<string, number>;

    const overdueTasks = db
      .prepare(
        `
        SELECT COUNT(*) as c
        FROM tasks tk
        JOIN properties p ON p.id = tk.property_id
        WHERE (${scope.sql})
          AND tk.status != 'completed'
          AND tk.due_date IS NOT NULL
          AND tk.due_date < date('now')
      `
      )
      .get(...scope.params) as { c: number };

    const recentTasks = db
      .prepare(
        `
        SELECT
          tk.*,
          p.system_uid,
          p.address as property_address,
          p.cadastral_status,
          p.latitude,
          p.longitude,
          t.name as tuman_name,
          m.name as mahalla_name,
          u.full_name as assigned_to_name
        FROM tasks tk
        JOIN properties p ON p.id = tk.property_id
        JOIN regions t ON t.id = p.tuman_id
        JOIN regions m ON m.id = p.mahalla_id
        LEFT JOIN users u ON u.id = tk.assigned_to
        WHERE ${scope.sql}
        ORDER BY
          CASE WHEN tk.status = 'completed' THEN 1 ELSE 0 END ASC,
          tk.due_date ASC,
          tk.id DESC
        LIMIT 8
      `
      )
      .all(...scope.params);

    const mahallaSummary = db
      .prepare(
        `
        SELECT
          t.name as tuman_name,
          m.id as mahalla_id,
          m.name as mahalla_name,
          COUNT(DISTINCT p.system_uid) as total,
          COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed' THEN p.system_uid END) as confirmed,
          COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed_absent' THEN p.system_uid END) as absent,
          COUNT(DISTINCT CASE WHEN p.cadastral_status = 'unverified' THEN p.system_uid END) as unverified
        FROM properties p
        JOIN regions t ON t.id = p.tuman_id
        JOIN regions m ON m.id = p.mahalla_id
        WHERE ${scope.sql}
        GROUP BY m.id
        ORDER BY total DESC
      `
      )
      .all(...scope.params);

    const recentLogs =
      user.role === 'admin'
        ? db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 8').all()
        : [];

    res.json({
      stats: {
        ...stats,
        overdue_tasks: overdueTasks.c,
      },
      recentTasks,
      mahallaSummary,
      recentLogs,
    });
  });

  app.get(
    '/api/reports/summary',
    requireAuth,
    requireRoles('admin', 'inspector'),
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const scope = buildPropertyScopeClause(user, 'p');

      const byMahalla = db
        .prepare(
          `
          SELECT
            t.id as tuman_id,
            t.name as tuman_name,
            m.id as mahalla_id,
            m.name as mahalla_name,
            COUNT(DISTINCT p.system_uid) as total_objects,
            COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed' THEN p.system_uid END) as confirmed_count,
            COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed_absent' THEN p.system_uid END) as confirmed_absent_count,
            COUNT(DISTINCT CASE WHEN p.cadastral_status = 'unverified' THEN p.system_uid END) as unverified_count,
            COUNT(DISTINCT CASE WHEN p.inspection_status IN ('sent_for_inspection','assigned','in_progress','reopened') THEN p.system_uid END) as in_inspection_count,
            COUNT(DISTINCT CASE WHEN p.inspection_status = 'needs_info' THEN p.system_uid END) as needs_info_count,
            COUNT(DISTINCT CASE WHEN p.inspection_status = 'completed' THEN p.system_uid END) as completed_count
          FROM properties p
          JOIN regions t ON t.id = p.tuman_id
          JOIN regions m ON m.id = p.mahalla_id
          WHERE ${scope.sql}
          GROUP BY t.id, m.id
          ORDER BY t.name, m.name
        `
        )
        .all(...scope.params);

      const inspectorStats = db
        .prepare(
          `
          SELECT
            u.id,
            u.full_name,
            t.name as tuman_name,
            COUNT(tk.id) as total_tasks,
            SUM(CASE WHEN tk.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
            SUM(CASE WHEN tk.status IN ('assigned','in_progress','reopened') THEN 1 ELSE 0 END) as active_tasks,
            SUM(CASE WHEN tk.status = 'needs_info' THEN 1 ELSE 0 END) as needs_info_tasks,
            SUM(CASE WHEN tk.status != 'completed' AND tk.due_date < date('now') THEN 1 ELSE 0 END) as overdue_tasks
          FROM users u
          LEFT JOIN regions t ON t.id = u.tuman_id
          LEFT JOIN tasks tk ON tk.assigned_to = u.id
          WHERE u.role = 'inspector'
            ${user.role === 'inspector' ? 'AND u.id = ?' : ''}
          GROUP BY u.id
          ORDER BY total_tasks DESC
        `
        )
        .all(...(user.role === 'inspector' ? [user.id] : []));

      const importsSummary =
        user.role === 'admin'
          ? db
              .prepare(
                `SELECT i.*, u.full_name as uploaded_by_name
                 FROM imports i
                 LEFT JOIN users u ON u.id = i.uploaded_by
                 ORDER BY i.id DESC LIMIT 10`
              )
              .all()
          : [];

      res.json({
        byMahalla,
        inspectorStats,
        importsSummary,
      });
    }
  );

  app.get(
    '/api/reports/export.xlsx',
    requireAuth,
    requireRoles('admin', 'inspector'),
    (req: AuthedRequest, res: Response) => {
      try {
        const buffer = generateReportsExcelBuffer(req.user!);
        writeAuditLog({
          actor_id: req.user!.id,
          actor_name: req.user!.full_name,
          actor_role: req.user!.role,
          action: 'REPORT_EXPORTED_EXCEL',
          entity_type: 'reports',
          summary: `${req.user!.full_name} kadastr va tekshiruv hisobotini Excel (.xlsx) shaklida yuklab oldi.`,
          ip_address: req.ip,
        });
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="ekadastr_hisobot_${new Date().toISOString().slice(0, 10)}.xlsx"`
        );
        res.send(buffer);
      } catch (err: any) {
        res.status(500).json({ error: 'Excel hisobotini shakllantirishda xatolik.' });
      }
    }
  );

  // ============================================================================
  // 4. SATELLITE MAP VIEWPORT API, SMART ADDRESS SEARCH & REGISTRY (TZ 6, 7, 15)
  // ============================================================================
  const normalizeUzbekAddr = (raw: string): string =>
    raw
      .toLowerCase()
      .replace(/[‘’`ʻʼ']/g, "'")
      .replace(/(\d+)\s*-\s*uy\b/g, '$1 uy')
      .replace(/[,.;:#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  app.get('/api/map/search-address', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.user!;
      const rawQuery = String(req.query.q ?? '').trim();
      if (!rawQuery) {
        res.json({ dbMatches: [], geoMatches: [] });
        return;
      }

      const scope = buildPropertyScopeClause(user, 'p');
      const allScopedRows = db
        .prepare(
          `
          SELECT
            p.*,
            v.name as viloyat_name,
            t.name as tuman_name,
            m.name as mahalla_name,
            u.full_name as assigned_user_name
          FROM properties p
          JOIN regions v ON v.id = p.viloyat_id
          JOIN regions t ON t.id = p.tuman_id
          JOIN regions m ON m.id = p.mahalla_id
          LEFT JOIN users u ON u.id = p.assigned_user_id
          WHERE ${scope.sql}
        `
        )
        .all(...scope.params) as Record<string, any>[];

      const normQ = normalizeUzbekAddr(rawQuery);
      const qTokens = normQ
        .split(' ')
        .filter((tok) => tok.length > 0 && !['uy', "ko'chasi", 'kochasi', "ko'cha", 'shoh', 'mfy', 'mahalla', 'mahallasi'].includes(tok));
      const numberTokens: string[] = normQ.match(/\b\d+[a-z]?\b/g) ?? [];

      const scoredDb: { row: Record<string, any>; score: number }[] = [];

      for (const r of allScopedRows) {
        const fullHaystack = normalizeUzbekAddr(
          `${r.viloyat_name ?? ''} ${r.tuman_name ?? ''} ${r.mahalla_name ?? ''} ${r.address ?? ''} ${r.address_code ?? ''} ${r.system_uid ?? ''} ${r.cadastral_number ?? ''}`
        );
        const addrOnly = normalizeUzbekAddr(String(r.address ?? ''));
        const uidNorm = String(r.system_uid ?? '').toLowerCase();
        const cadNorm = String(r.cadastral_number ?? '').toLowerCase();

        let score = 0;

        if (uidNorm === rawQuery.toLowerCase() || (cadNorm && cadNorm === rawQuery.toLowerCase())) {
          score += 300;
        } else if (addrOnly === normQ) {
          score += 260;
        } else if (addrOnly.includes(normQ) || fullHaystack.includes(normQ)) {
          score += 180;
        }

        if (qTokens.length > 0) {
          let matchedTokens = 0;
          for (const tok of qTokens) {
            if (fullHaystack.includes(tok)) {
              matchedTokens++;
            }
          }
          if (matchedTokens === qTokens.length) {
            score += 120 + matchedTokens * 15;
          } else if (matchedTokens > 0 && score > 0) {
            score += matchedTokens * 10;
          }
        }

        // Exact house number match bonus (ensures "Ziyolilar ko'chasi, 23-uy" beats "Ziyolilar ko'chasi, 31-uy")
        if (numberTokens.length > 0 && score > 0) {
          const addrNums: string[] = addrOnly.match(/\b\d+[a-z]?\b/g) ?? [];
          const exactNumHit = numberTokens.every((n) => addrNums.includes(n));
          if (exactNumHit) {
            score += 90;
          } else {
            score -= 60;
          }
        }

        if (r.latitude !== null && r.longitude !== null) {
          score += 5;
        }

        if (score > 40) {
          scoredDb.push({ row: r, score });
        }
      }

      scoredDb.sort((a, b) => b.score - a.score);
      const dbMatches = scoredDb.slice(0, 8).map((item) => enrichProperty(item.row));

      // Nationwide Uzbekistan Search: All 14 Viloyatlar, 208 Tuman/Shaharlar, Qishloqlar, MFYlar, Ko‘chalar & Uylar
      const geoMatches: {
        id: string;
        display_name: string;
        short_address: string;
        lat: number;
        lng: number;
        type: string;
        zoom: number;
        category_label: string;
      }[] = [];

      const addGeoCandidate = (cand: {
        id: string;
        display_name: string;
        short_address: string;
        lat: number;
        lng: number;
        type: string;
        zoom: number;
        category_label: string;
      }) => {
        if (
          cand.lat < 36.8 ||
          cand.lat > 45.8 ||
          cand.lng < 55.8 ||
          cand.lng > 73.5
        ) {
          return;
        }
        const isDup = geoMatches.some(
          (g) =>
            Math.abs(g.lat - cand.lat) < 0.0025 &&
            Math.abs(g.lng - cand.lng) < 0.0025 &&
            normalizeUzbekAddr(g.short_address) === normalizeUzbekAddr(cand.short_address)
        );
        if (!isDup && geoMatches.length < 12) {
          geoMatches.push(cand);
        }
      };

      const normPlaceQ = normalizeUzbekAddr(rawQuery)
        .replace(
          /\b(viloyati|viloyat|respublikasi|respublika|tumani|tuman|shahri|shahar|qishlog'i|qishlogi|qishloq|shaharchasi|shaharcha|mahallasi|mahalla|mfy|qfy|ofy)\b/g,
          ' '
        )
        .replace(/\s+/g, ' ')
        .trim();

      // 1) Instant Directory Match: All 14 Viloyatlar & All 208 Tuman/Shaharlar
      if (normPlaceQ.length >= 2) {
        for (const vil of UZBEKISTAN_DIRECTORY) {
          const normVil = normalizeUzbekAddr(vil.name)
            .replace(/\b(viloyati|respublikasi|shahri)\b/g, '')
            .trim();
          if (
            normalizeUzbekAddr(vil.name).includes(normQ) ||
            (normPlaceQ.length >= 3 && normVil.includes(normPlaceQ))
          ) {
            addGeoCandidate({
              id: `dir_vil_${vil.code}`,
              display_name: `${vil.name}, O‘zbekiston`,
              short_address: vil.name,
              lat: vil.lat,
              lng: vil.lng,
              type: 'state',
              zoom: vil.zoom || 9,
              category_label: 'Viloyat',
            });
          }

          for (const dist of vil.districts) {
            const normDistFull = normalizeUzbekAddr(`${dist.name} ${vil.name}`);
            const normDistCore = normalizeUzbekAddr(dist.name)
              .replace(/\b(tumani|shahri)\b/g, '')
              .trim();
            if (
              normDistFull.includes(normQ) ||
              (normPlaceQ.length >= 2 && normDistCore.includes(normPlaceQ))
            ) {
              addGeoCandidate({
                id: `dir_dist_${dist.code}`,
                display_name: `${dist.name}, ${vil.name}, O‘zbekiston`,
                short_address: `${dist.name} (${vil.name})`,
                lat: dist.lat,
                lng: dist.lng,
                type: 'district',
                zoom: dist.zoom || 13,
                category_label: dist.name.includes('shahri') ? 'Shahar' : 'Tuman',
              });
            }
          }
        }

        // Also match seeded Mahallas in SQLite regions table
        const mahallaRegions = db
          .prepare(
            `SELECT m.id, m.name, m.center_lat, m.center_lng, t.name as tuman_name, v.name as viloyat_name
             FROM regions m
             LEFT JOIN regions t ON t.id = m.parent_id
             LEFT JOIN regions v ON v.id = t.parent_id
             WHERE m.level = 'mahalla'`
          )
          .all() as Record<string, any>[];

        for (const mr of mahallaRegions) {
          const normM = normalizeUzbekAddr(`${mr.name} ${mr.tuman_name ?? ''} ${mr.viloyat_name ?? ''}`);
          if (normM.includes(normQ) || (normPlaceQ.length >= 3 && normM.includes(normPlaceQ))) {
            addGeoCandidate({
              id: `reg_mah_${mr.id}`,
              display_name: `${mr.name}, ${mr.tuman_name ?? ''}, ${mr.viloyat_name ?? ''}`,
              short_address: `${mr.name} (${mr.tuman_name ?? ''})`,
              lat: Number(mr.center_lat),
              lng: Number(mr.center_lng),
              type: 'mahalla',
              zoom: 16,
              category_label: 'Mahalla (MFY)',
            });
          }
        }
      }

      // 2) Nationwide Uzbekistan Villages (Qishloqlar), Settlements, Mahallas, Streets & Houses
      if (rawQuery.length >= 2) {
        const cleanedNationwide = rawQuery
          .replace(/[‘’`ʻʼ]/g, "'")
          .replace(/(\d+)\s*-?\s*uy\b/gi, '$1')
          .replace(/\b(qishlog'i|qishlogi)\b/gi, '')
          .replace(/\bMFY\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

        const fetchArcGis = async () => {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 3200);
          try {
            const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(
              cleanedNationwide
            )}&countryCode=UZB&maxLocations=6&outFields=Match_addr,LongLabel,Addr_type,Type,City,Subregion,Region&langCode=uz&f=json`;
            const r = await fetch(url, { signal: controller.signal });
            if (!r.ok) return [];
            const data = (await r.json()) as any;
            return (data.candidates ?? []) as any[];
          } finally {
            clearTimeout(t);
          }
        };

        const fetchPhoton = async (qStr: string) => {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 3200);
          try {
            const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
              qStr
            )}&bbox=55.9,37.1,73.2,45.6&limit=6`;
            const r = await fetch(url, { signal: controller.signal });
            if (!r.ok) return [];
            const data = (await r.json()) as any;
            return (data.features ?? []) as any[];
          } finally {
            clearTimeout(t);
          }
        };

        const looksLikeLocalStreetHouse =
          (/\b\d+\b/.test(cleanedNationwide) || /ko'cha|kocha/i.test(cleanedNationwide)) &&
          !/viloyat|tuman|shahar|shahri|andijon|toshkent|farg|namangan|samarqand|buxoro|xorazm|navoiy|jizzax|sirdaryo|qashqadaryo|surxondaryo|nukus|qoraqalpog/i.test(
            cleanedNationwide
          );

        const [arcSettled, photonNationwideSettled, photonLocalSettled] = await Promise.allSettled([
          fetchArcGis(),
          fetchPhoton(cleanedNationwide),
          looksLikeLocalStreetHouse
            ? fetchPhoton(`${cleanedNationwide} ${user.tuman_name || 'Andijon'}`)
            : Promise.resolve([]),
        ]);

        // Process local street/house hits first if query was a bare street+house
        const parsePhotonFeature = (f: any, idx: number, prefix: string) => {
          const coords = f?.geometry?.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) return;
          const lng = Number(coords[0]);
          const lat = Number(coords[1]);
          if (Number.isNaN(lat) || Number.isNaN(lng)) return;

          const p = f.properties || {};
          if (p.countrycode && String(p.countrycode).toUpperCase() !== 'UZ') return;

          const osmVal = String(p.osm_value || p.type || 'locality').toLowerCase();
          const hasHouseNum = Boolean(p.housenumber) || /\b\d+\s*дом\b/i.test(String(p.name || ''));

          let zoom = 15;
          let categoryLabel = 'Qishloq / Aholi punkti';
          if (hasHouseNum || ['house', 'building', 'apartments', 'pharmacy', 'school', 'hospital'].includes(osmVal)) {
            zoom = 19;
            categoryLabel = 'Aniq manzil / Uy';
          } else if (['residential', 'primary', 'secondary', 'tertiary', 'street', 'road', 'service', 'unclassified'].includes(osmVal)) {
            zoom = 17;
            categoryLabel = 'Ko‘cha';
          } else if (['suburb', 'neighbourhood', 'quarter'].includes(osmVal)) {
            zoom = 16;
            categoryLabel = 'Mahalla / Mavze';
          } else if (['village', 'hamlet', 'allotments'].includes(osmVal)) {
            zoom = 15;
            categoryLabel = 'Qishloq';
          } else if (['town', 'city'].includes(osmVal)) {
            zoom = 13;
            categoryLabel = 'Shahar / Shaharcha';
          } else if (['county', 'district'].includes(osmVal)) {
            zoom = 12;
            categoryLabel = 'Tuman';
          } else if (['state', 'region'].includes(osmVal)) {
            zoom = 9;
            categoryLabel = 'Viloyat';
          }

          const titleParts = [
            p.name,
            p.street ? `${p.street}${p.housenumber ? `, ${p.housenumber}-uy` : ''}` : p.housenumber ? `${p.housenumber}-uy` : '',
          ].filter(Boolean);
          const areaParts = [p.district || p.city || p.county, p.state].filter(Boolean);

          const shortAddr =
            titleParts.join(', ') || areaParts.join(', ') || cleanedNationwide;
          const fullDisp = [...titleParts, ...areaParts, 'O‘zbekiston']
            .filter(Boolean)
            .join(', ');

          addGeoCandidate({
            id: `${prefix}_${p.osm_id || idx}_${lat.toFixed(4)}`,
            display_name: fullDisp,
            short_address: shortAddr,
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
            type: osmVal,
            zoom,
            category_label: categoryLabel,
          });
        };

        if (photonLocalSettled.status === 'fulfilled') {
          photonLocalSettled.value.forEach((f, idx) => parsePhotonFeature(f, idx, 'phloc'));
        }

        if (arcSettled.status === 'fulfilled') {
          arcSettled.value.forEach((c: any, idx: number) => {
            const lat = Number(c?.location?.y);
            const lng = Number(c?.location?.x);
            if (Number.isNaN(lat) || Number.isNaN(lng)) return;

            const addrType = String(c?.attributes?.Addr_type || '');
            const subType = String(c?.attributes?.Type || '');
            const longLabel = String(c?.attributes?.LongLabel || c?.address || '')
              .replace(/,\s*UZB$/i, ', O‘zbekiston');
            const shortLabel = String(c?.address || longLabel).replace(/,\s*UZB$/i, '');

            // Skip generic country-level match "O'zbekiston" unless searched explicitly
            if (addrType === 'Country') return;

            let zoom = 15;
            let categoryLabel = 'Qishloq / Aholi punkti';
            if (addrType === 'PointAddress' || addrType === 'Subaddress' || addrType === 'BuildingName') {
              zoom = 19;
              categoryLabel = 'Aniq manzil / Uy';
            } else if (addrType === 'StreetAddress' || addrType === 'StreetName') {
              zoom = /\d/.test(shortLabel) ? 19 : 17;
              categoryLabel = /\d/.test(shortLabel) ? 'Aniq manzil / Uy' : 'Ko‘cha';
            } else if (subType === 'State or Province') {
              zoom = 9;
              categoryLabel = 'Viloyat';
            } else if (subType === 'County') {
              zoom = 12;
              categoryLabel = 'Tuman';
            } else if (subType === 'Neighborhood' || addrType === 'Neighborhood') {
              zoom = 16;
              categoryLabel = 'Mahalla / Mavze';
            } else if (subType === 'City' || addrType === 'Locality') {
              zoom = 15;
              categoryLabel = 'Shahar / Qishloq';
            }

            addGeoCandidate({
              id: `arc_${idx}_${lat.toFixed(4)}_${lng.toFixed(4)}`,
              display_name: longLabel,
              short_address: shortLabel,
              lat: Number(lat.toFixed(6)),
              lng: Number(lng.toFixed(6)),
              type: addrType.toLowerCase() || 'locality',
              zoom,
              category_label: categoryLabel,
            });
          });
        }

        if (photonNationwideSettled.status === 'fulfilled') {
          photonNationwideSettled.value.forEach((f, idx) => parsePhotonFeature(f, idx, 'phuz'));
        }
      }

      res.json({ dbMatches, geoMatches });
    } catch (err: any) {
      console.error('Address search error:', err);
      res.status(500).json({ error: 'Manzilni qidirishda xatolik yuz berdi.' });
    }
  });

  app.get('/api/uzbekistan-directory', requireAuth, (_req: AuthedRequest, res: Response) => {
    res.json(UZBEKISTAN_DIRECTORY);
  });

  // Inspect ANY clicked house / building rooftop on the Uzbekistan satellite map
  app.get('/api/map/inspect-point', requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const user = req.user!;
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);

      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        res.status(400).json({ error: 'Koordinatalar noto‘g‘ri berildi.' });
        return;
      }

      const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371000;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      const isPointInPolygon = (ptLat: number, ptLng: number, poly: [number, number][]): boolean => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const yi = poly[i][0];
          const xi = poly[i][1];
          const yj = poly[j][0];
          const xj = poly[j][1];
          const intersect =
            yi > ptLat !== yj > ptLat &&
            ptLng < ((xj - xi) * (ptLat - yi)) / (yj - yi + 1e-12) + xi;
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const computePolygonAreaM2 = (poly: [number, number][]): number | null => {
        if (poly.length < 3) return null;
        const lat0 = poly[0][0];
        const lon0 = poly[0][1];
        const cosLat = Math.cos((lat0 * Math.PI) / 180);
        let sum = 0;
        for (let i = 0; i < poly.length; i++) {
          const [latA, lonA] = poly[i];
          const [latB, lonB] = poly[(i + 1) % poly.length];
          const xA = (lonA - lon0) * 111320 * cosLat;
          const yA = (latA - lat0) * 110540;
          const xB = (lonB - lon0) * 111320 * cosLat;
          const yB = (latB - lat0) * 110540;
          sum += xA * yB - xB * yA;
        }
        const area = Math.abs(sum) / 2;
        return area >= 4 && area <= 50000 ? Math.round(area) : null;
      };

      // 1) Check registered E-Kadastr DB properties within ~28m of click (scoped to user RBAC)
      const scope = buildPropertyScopeClause(user, 'p');
      const nearbyDbRows = db
        .prepare(
          `
          SELECT
            p.*,
            v.name as viloyat_name,
            t.name as tuman_name,
            m.name as mahalla_name,
            u.full_name as assigned_user_name
          FROM properties p
          JOIN regions v ON v.id = p.viloyat_id
          JOIN regions t ON t.id = p.tuman_id
          JOIN regions m ON m.id = p.mahalla_id
          LEFT JOIN users u ON u.id = p.assigned_user_id
          WHERE (${scope.sql})
            AND p.latitude IS NOT NULL
            AND p.longitude IS NOT NULL
            AND p.location_verified = 1
            AND p.latitude BETWEEN ? AND ?
            AND p.longitude BETWEEN ? AND ?
        `
        )
        .all(
          ...scope.params,
          lat - 0.00038,
          lat + 0.00038,
          lng - 0.00048,
          lng + 0.00048
        ) as Record<string, any>[];

      let matchedProperty: any = null;
      let minDbDist = Infinity;
      for (const r of nearbyDbRows) {
        const d = haversineMeters(lat, lng, Number(r.latitude), Number(r.longitude));
        if (d <= 28 && d < minDbDist) {
          minDbDist = d;
          matchedProperty = enrichProperty({
            ...r,
            owner_reference: user.role === 'mahalla' ? null : r.owner_reference,
          });
        }
      }

      // 2) Parallel Reverse Geocoding + OSM Rooftop Building Geometry (with fast in-memory cache)
      const cacheKey = `${lat.toFixed(5)}_${lng.toFixed(5)}`;
      const inspectCache: Map<string, any> =
        (globalThis as any).__ekadastrInspectCache ||
        ((globalThis as any).__ekadastrInspectCache = new Map<string, any>());

      let geoPayload = inspectCache.get(cacheKey);

      if (!geoPayload) {
        const reqHeaders = {
          'User-Agent': 'EKadastrNazoratAndijonPilot/1.0',
          Accept: 'application/json',
        };

        const fetchNominatimRev = async () => {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2600);
          try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&extratags=1&polygon_geojson=1&accept-language=uz`;
            const r = await fetch(url, { signal: ctrl.signal, headers: reqHeaders });
            if (!r.ok) return null;
            const ct = r.headers.get('content-type') || '';
            if (!ct.includes('json')) return null;
            return (await r.json()) as any;
          } finally {
            clearTimeout(t);
          }
        };

        const fetchArcRev = async () => {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2200);
          try {
            const r = await fetch(
              `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${lng},${lat}&featureTypes=PointAddress,StreetAddress,BuildingName,StreetName,Neighborhood,Locality&langCode=uz&f=json`,
              { signal: ctrl.signal, headers: reqHeaders }
            );
            if (!r.ok) return null;
            const j = (await r.json()) as any;
            return j?.address ?? null;
          } finally {
            clearTimeout(t);
          }
        };

        const fetchOverpassBbox = async () => {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2000);
          const s = (lat - 0.00028).toFixed(5);
          const w = (lng - 0.00035).toFixed(5);
          const n = (lat + 0.00028).toFixed(5);
          const e = (lng + 0.00035).toFixed(5);
          const query = `[out:json][timeout:2];way(${s},${w},${n},${e})["building"];out body geom;`;
          try {
            const r = await fetch(
              `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
              { signal: ctrl.signal, headers: reqHeaders }
            );
            if (!r.ok) return [];
            const ct = r.headers.get('content-type') || '';
            if (!ct.includes('json')) return [];
            const j = (await r.json()) as any;
            return Array.isArray(j?.elements) ? (j.elements as any[]) : [];
          } catch {
            return [];
          } finally {
            clearTimeout(t);
          }
        };

        const [nomRes, arcRes, overpassRes] = await Promise.allSettled([
          fetchNominatimRev(),
          fetchArcRev(),
          fetchOverpassBbox(),
        ]);

        const nom = nomRes.status === 'fulfilled' ? nomRes.value : null;
        const arc = arcRes.status === 'fulfilled' ? arcRes.value : null;
        const ways = overpassRes.status === 'fulfilled' ? overpassRes.value : [];

        // Extract polygon & tags from Overpass first, or from Nominatim polygon_geojson
        let bestWay: any = null;
        let bestPoly: [number, number][] | null = null;
        let bestWayDist = Infinity;

        for (const w of ways) {
          if (!Array.isArray(w?.geometry) || w.geometry.length < 3) continue;
          const poly: [number, number][] = w.geometry.map((pt: any) => [
            Number(pt.lat),
            Number(pt.lon),
          ]);
          if (isPointInPolygon(lat, lng, poly)) {
            bestWay = w;
            bestPoly = poly;
            break;
          }
          const avgLat = poly.reduce((s, p) => s + p[0], 0) / poly.length;
          const avgLng = poly.reduce((s, p) => s + p[1], 0) / poly.length;
          const d = haversineMeters(lat, lng, avgLat, avgLng);
          if (d < bestWayDist && d <= 24) {
            bestWayDist = d;
            bestWay = w;
            bestPoly = poly;
          }
        }

        // If Nominatim returned a building Polygon directly, use it when Overpass didn't find one
        if (
          !bestPoly &&
          nom?.geojson?.type === 'Polygon' &&
          Array.isArray(nom.geojson.coordinates?.[0]) &&
          nom.geojson.coordinates[0].length >= 3 &&
          (nom?.category === 'building' || nom?.extratags?.building)
        ) {
          bestPoly = nom.geojson.coordinates[0].map((c: any) => [Number(c[1]), Number(c[0])]);
        }

        const tags = { ...(nom?.extratags ?? {}), ...(bestWay?.tags ?? {}) };
        const nomAddr = nom?.address ?? {};
        const hasBuilding = Boolean(bestWay || nom?.category === 'building' || tags.building);

        const rawBType = String(tags.building || nom?.type || '').toLowerCase();
        const bTypeMap: Record<string, string> = {
          yes: 'Turar-joy / Uy-joy binosi',
          house: 'Yakka tartibdagi uy-joy',
          residential: 'Turar-joy binosi',
          detached: 'Hovlili uy-joy',
          apartments: 'Ko‘p qavatli turar-joy uyi',
          commercial: 'Savdo va xizmat binosi',
          retail: 'Savdo do‘koni / bino',
          hotel: 'Mehmonxona / xizmat binosi',
          industrial: 'Ishlab chiqarish binosi',
          school: 'Maktab binosi',
          kindergarten: 'Maktabgacha ta’lim muassasasi',
          hospital: 'Tibbiyot muassasasi',
          public: 'Jamoat binosi',
          mosque: 'Masjid binosi',
          garage: 'Garaj / xo‘jalik imorati',
          shed: 'Qo‘shimcha xo‘jalik imorati',
          roof: 'Bostirma / ayvon',
        };

        const matMap: Record<string, string> = {
          brick: 'Pishiq g‘isht',
          concrete: 'Temir-beton',
          cement_block: 'Shlakoblok',
          mud: 'Xom g‘isht / paxsa',
          adobe: 'Xom g‘isht / paxsa',
          stone: 'Tosh',
          wood: 'Yog‘och',
          metal: 'Metall konstruksiya',
        };

        const roofMap: Record<string, string> = {
          metal: 'Tunuka / profnastil',
          slate: 'Shifer',
          eternit: 'Shifer',
          roof_tiles: 'Cherepitsa',
          concrete: 'Temir-beton plita',
          tar_paper: 'Ruberoit / yumshoq tom',
        };

        const yearStr = String(
          tags['start_date'] || tags['building:year'] || tags['year_built'] || ''
        ).trim();
        const yearMatch = yearStr.match(/\b(18\d{2}|19\d{2}|20[0-2]\d)\b/);
        const parsedYear = yearMatch ? Number(yearMatch[1]) : null;

        const levelsNum = tags['building:levels'] ? Number(tags['building:levels']) : null;
        const validLevels =
          levelsNum && !Number.isNaN(levelsNum) && levelsNum > 0 && levelsNum <= 50
            ? Math.round(levelsNum)
            : null;

        const rawMat = String(tags['building:material'] || tags['material'] || '').toLowerCase();
        const rawRoof = String(tags['roof:material'] || '').toLowerCase();

        // Nearest Uzbekistan directory district fallback so region/district are always filled in Uzbek
        let nearestVilName: string | null = null;
        let nearestDistName: string | null = null;
        let nearestDistMeters = Infinity;
        for (const vil of UZBEKISTAN_DIRECTORY) {
          for (const dist of vil.districts) {
            const dm = haversineMeters(lat, lng, dist.lat, dist.lng);
            if (dm < nearestDistMeters) {
              nearestDistMeters = dm;
              nearestVilName = vil.name;
              nearestDistName = dist.name;
            }
          }
        }

        const streetName =
          tags['addr:street'] ||
          nomAddr.road ||
          nomAddr.pedestrian ||
          nomAddr.residential ||
          (arc?.Address ? String(arc.Address).replace(/\b\d+[a-zA-Z]?\b/, '').trim() : '') ||
          null;
        const houseNum =
          tags['addr:housenumber'] ||
          nomAddr.house_number ||
          (arc?.AddNum ? String(arc.AddNum).trim() : '') ||
          null;

        const streetHouse = streetName
          ? `${streetName}${houseNum ? `, ${houseNum}-uy` : ''}`
          : houseNum
          ? `${houseNum}-uy`
          : arc?.Address
          ? String(arc.Address)
          : null;

        const mahallaOrVillage =
          tags['addr:mahalla'] ||
          tags['addr:suburb'] ||
          nomAddr.suburb ||
          nomAddr.neighbourhood ||
          nomAddr.quarter ||
          nomAddr.village ||
          nomAddr.hamlet ||
          (arc?.Neighborhood ? String(arc.Neighborhood) : null) ||
          null;

        const districtLabel =
          nearestDistMeters <= 65000 && nearestDistName
            ? nearestDistName
            : nomAddr.city || nomAddr.county || nomAddr.town || arc?.Subregion || arc?.City || nearestDistName;

        const regionLabel =
          nearestDistMeters <= 95000 && nearestVilName
            ? nearestVilName
            : nomAddr.state || arc?.Region || nearestVilName;

        const composedAddress =
          [streetHouse, mahallaOrVillage, districtLabel]
            .filter(Boolean)
            .join(', ') ||
          arc?.Match_addr ||
          `${districtLabel || 'O‘zbekiston'} (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

        geoPayload = {
          address: composedAddress,
          street_house: streetHouse,
          mahalla_or_village: mahallaOrVillage,
          district: districtLabel,
          region: regionLabel,
          osmBuilding: {
            found: hasBuilding,
            name: tags.name ? String(tags.name) : nom?.name ? String(nom.name) : null,
            building_type_label:
              bTypeMap[rawBType] ||
              (hasBuilding ? 'Turar-joy / Uy-joy binosi' : 'Sun’iy yo‘ldosh tasviridagi uy / bino'),
            built_year: parsedYear,
            floors_count: validLevels,
            wall_material: rawMat ? matMap[rawMat] || rawMat : null,
            roof_material: rawRoof ? roofMap[rawRoof] || rawRoof : null,
            footprint_area_m2: bestPoly ? computePolygonAreaM2(bestPoly) : null,
            house_number: houseNum,
            street: streetName,
            polygon: bestPoly,
          },
        };

        if (inspectCache.size > 300) {
          const firstKey = inspectCache.keys().next().value;
          if (firstKey) inspectCache.delete(firstKey);
        }
        inspectCache.set(cacheKey, geoPayload);
      }

      res.json({
        matchedProperty,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        address: matchedProperty?.address || geoPayload.address,
        street_house: geoPayload.street_house,
        mahalla_or_village: geoPayload.mahalla_or_village,
        district: geoPayload.district,
        region: geoPayload.region,
        osmBuilding: geoPayload.osmBuilding,
      });
    } catch (err: any) {
      console.error('Inspect point error:', err);
      res.status(500).json({ error: 'Tanlangan uy ma’lumotlarini aniqlashda xatolik.' });
    }
  });

  app.get('/api/properties/map', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const scope = buildPropertyScopeClause(user, 'p');

    const south = req.query.south !== undefined ? Number(req.query.south) : 39.5;
    const north = req.query.north !== undefined ? Number(req.query.north) : 42.0;
    const west = req.query.west !== undefined ? Number(req.query.west) : 70.5;
    const east = req.query.east !== undefined ? Number(req.query.east) : 74.0;

    const tumanId = req.query.tumanId ? Number(req.query.tumanId) : null;
    const mahallaId = req.query.mahallaId ? Number(req.query.mahallaId) : null;
    const cadastralStatus = req.query.cadastralStatus ? String(req.query.cadastralStatus) : '';
    const markerColor = req.query.markerColor ? String(req.query.markerColor) : '';
    const q = String(req.query.q ?? '').trim();

    const extraClauses: string[] = [scope.sql];
    const extraParams: (string | number)[] = [...scope.params];

    if (tumanId) {
      extraClauses.push('p.tuman_id = ?');
      extraParams.push(tumanId);
    }
    if (mahallaId) {
      extraClauses.push('p.mahalla_id = ?');
      extraParams.push(mahallaId);
    }
    if (cadastralStatus) {
      extraClauses.push('p.cadastral_status = ?');
      extraParams.push(cadastralStatus);
    }
    if (q) {
      extraClauses.push(
        '(p.system_uid LIKE ? OR p.address LIKE ? OR COALESCE(p.cadastral_number, "") LIKE ?)'
      );
      const like = `%${q}%`;
      extraParams.push(like, like, like);
    }

    const baseWhere = extraClauses.join(' AND ');

    // 1. Located objects ONLY inside visible viewport bounds (TZ Section 15)
    let viewportItems: any[] = [];
    if (markerColor !== 'gray') {
      const locatedRows = db
        .prepare(
          `
          SELECT
            p.*,
            v.name as viloyat_name,
            t.name as tuman_name,
            m.name as mahalla_name,
            u.full_name as assigned_user_name
          FROM properties p
          JOIN regions v ON v.id = p.viloyat_id
          JOIN regions t ON t.id = p.tuman_id
          JOIN regions m ON m.id = p.mahalla_id
          LEFT JOIN users u ON u.id = p.assigned_user_id
          WHERE ${baseWhere}
            AND p.latitude IS NOT NULL
            AND p.longitude IS NOT NULL
            AND p.location_verified = 1
            AND p.latitude BETWEEN ? AND ?
            AND p.longitude BETWEEN ? AND ?
          LIMIT 600
        `
        )
        .all(...extraParams, south, north, west, east) as Record<string, any>[];

      viewportItems = locatedRows.map(enrichProperty);
      if (markerColor) {
        viewportItems = viewportItems.filter((item) => item.marker_color === markerColor);
      }
    }

    // 2. Unlocated (Gray) objects in current region filter so authorized staff can see & locate them
    let unlocatedItems: any[] = [];
    if (!markerColor || markerColor === 'gray') {
      const grayRows = db
        .prepare(
          `
          SELECT
            p.*,
            v.name as viloyat_name,
            t.name as tuman_name,
            m.name as mahalla_name,
            u.full_name as assigned_user_name
          FROM properties p
          JOIN regions v ON v.id = p.viloyat_id
          JOIN regions t ON t.id = p.tuman_id
          JOIN regions m ON m.id = p.mahalla_id
          LEFT JOIN users u ON u.id = p.assigned_user_id
          WHERE ${baseWhere}
            AND (p.latitude IS NULL OR p.longitude IS NULL OR p.location_verified = 0)
          ORDER BY p.id DESC
          LIMIT 100
        `
        )
        .all(...extraParams) as Record<string, any>[];

      unlocatedItems = grayRows.map(enrichProperty);
    }

    res.json({
      viewportItems,
      unlocatedItems,
    });
  });

  // Server-side Paginated & Filtered Properties List (TZ Section 15)
  app.get('/api/properties', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const scope = buildPropertyScopeClause(user, 'p');

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize ?? 12)));
    const offset = (page - 1) * pageSize;

    const tumanId = req.query.tumanId ? Number(req.query.tumanId) : null;
    const mahallaId = req.query.mahallaId ? Number(req.query.mahallaId) : null;
    const cadastralStatus = req.query.cadastralStatus ? String(req.query.cadastralStatus) : '';
    const inspectionStatus = req.query.inspectionStatus ? String(req.query.inspectionStatus) : '';
    const markerColor = req.query.markerColor ? String(req.query.markerColor) : '';
    const q = String(req.query.q ?? '').trim();

    const clauses: string[] = [scope.sql];
    const params: (string | number)[] = [...scope.params];

    if (tumanId) {
      clauses.push('p.tuman_id = ?');
      params.push(tumanId);
    }
    if (mahallaId) {
      clauses.push('p.mahalla_id = ?');
      params.push(mahallaId);
    }
    if (cadastralStatus) {
      clauses.push('p.cadastral_status = ?');
      params.push(cadastralStatus);
    }
    if (inspectionStatus) {
      clauses.push('p.inspection_status = ?');
      params.push(inspectionStatus);
    }
    if (markerColor === 'gray') {
      clauses.push('(p.latitude IS NULL OR p.longitude IS NULL OR p.location_verified = 0)');
    } else if (markerColor === 'green') {
      clauses.push("p.latitude IS NOT NULL AND p.location_verified = 1 AND p.cadastral_status = 'confirmed'");
    } else if (markerColor === 'red') {
      clauses.push("p.latitude IS NOT NULL AND p.location_verified = 1 AND p.cadastral_status = 'confirmed_absent'");
    } else if (markerColor === 'yellow') {
      clauses.push("p.latitude IS NOT NULL AND p.location_verified = 1 AND p.cadastral_status = 'unverified'");
    }
    if (q) {
      clauses.push(
        '(p.system_uid LIKE ? OR p.address LIKE ? OR COALESCE(p.cadastral_number, "") LIKE ? OR COALESCE(p.address_code, "") LIKE ?)'
      );
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    const whereSql = clauses.join(' AND ');

    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM properties p WHERE ${whereSql}`)
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `
        SELECT
          p.*,
          v.name as viloyat_name,
          t.name as tuman_name,
          m.name as mahalla_name,
          u.full_name as assigned_user_name
        FROM properties p
        JOIN regions v ON v.id = p.viloyat_id
        JOIN regions t ON t.id = p.tuman_id
        JOIN regions m ON m.id = p.mahalla_id
        LEFT JOIN users u ON u.id = p.assigned_user_id
        WHERE ${whereSql}
        ORDER BY p.updated_at DESC, p.id DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(...params, pageSize, offset) as Record<string, any>[];

    res.json({
      items: rows.map(enrichProperty),
      total: countRow.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(countRow.total / pageSize)),
    });
  });

  // Full Property Card Details + History + Attachments (TZ Section 7)
  app.get('/api/properties/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);

    const row = db
      .prepare(
        `
        SELECT
          p.*,
          v.name as viloyat_name,
          t.name as tuman_name,
          m.name as mahalla_name,
          u.full_name as assigned_user_name,
          pu.full_name as pending_location_by_name
        FROM properties p
        JOIN regions v ON v.id = p.viloyat_id
        JOIN regions t ON t.id = p.tuman_id
        JOIN regions m ON m.id = p.mahalla_id
        LEFT JOIN users u ON u.id = p.assigned_user_id
        LEFT JOIN users pu ON pu.id = p.pending_location_by
        WHERE p.id = ?
      `
      )
      .get(id) as Record<string, any> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Obyekt topilmadi.' });
      return;
    }

    if (
      !canUserAccessRegion(user, {
        viloyat_id: row.viloyat_id,
        tuman_id: row.tuman_id,
        mahalla_id: row.mahalla_id,
      })
    ) {
      writeAuditLog({
        actor_id: user.id,
        actor_name: user.full_name,
        actor_role: user.role,
        action: 'CROSS_REGION_READ_DENIED',
        entity_type: 'properties',
        entity_id: row.system_uid,
        property_id: row.id,
        summary: `Boshqa hudud obyektini (${row.system_uid}) ko‘rishga ruxsat rad etildi.`,
        ip_address: req.ip,
      });
      res.status(403).json({ error: 'Boshqa mahalla yoki hudud ma’lumotlarini ko‘rish taqiqlanadi.' });
      return;
    }

    const cadastralRecords = db
      .prepare('SELECT * FROM cadastral_records WHERE property_id = ? ORDER BY id DESC')
      .all(id);

    const inspections = db
      .prepare(
        `SELECT i.*, u.full_name as inspector_name
         FROM inspections i
         LEFT JOIN users u ON u.id = i.inspector_id
         WHERE i.property_id = ?
         ORDER BY i.id DESC`
      )
      .all(id);

    const tasks = db
      .prepare(
        `SELECT tk.*, u.full_name as assigned_to_name, cu.full_name as created_by_name
         FROM tasks tk
         LEFT JOIN users u ON u.id = tk.assigned_to
         LEFT JOIN users cu ON cu.id = tk.created_by
         WHERE tk.property_id = ?
         ORDER BY tk.id DESC`
      )
      .all(id);

    const attachments = db
      .prepare(
        `SELECT a.*, u.full_name as uploaded_by_name
         FROM attachments a
         LEFT JOIN users u ON u.id = a.uploaded_by
         WHERE a.property_id = ?
         ORDER BY a.id DESC`
      )
      .all(id);

    const history = db
      .prepare(
        `SELECT * FROM audit_logs WHERE property_id = ? OR (entity_type = 'properties' AND entity_id = ?) ORDER BY id DESC LIMIT 30`
      )
      .all(id, row.system_uid);

    // Owner reference restricted strictly to Admin or Inspector if legally required (TZ Section 7)
    const property = enrichProperty({
      ...row,
      owner_reference: user.role === 'mahalla' ? null : row.owner_reference,
    });

    res.json({
      property,
      cadastralRecords,
      inspections,
      tasks,
      attachments,
      history,
    });
  });

  // Create / Pin New Residential Property (Admin or Mahalla rep or Inspector within scope)
  app.post('/api/properties', requireAuth, (req: AuthedRequest, res: Response) => {
    try {
      const user = req.user!;
      const {
        tuman_id,
        mahalla_id,
        address,
        address_code,
        parent_parcel_code,
        object_type,
        latitude,
        longitude,
        cadastral_number,
        notes,
        built_year,
        floors_count,
        rooms_count,
        land_area_m2,
        building_area_m2,
        wall_material,
        utilities_info,
        registration_date,
        request_inspection,
        inspection_reason,
      } = req.body;

      const targetMahallaId = user.role === 'mahalla' ? user.mahalla_id : Number(mahalla_id);
      const targetTumanId = user.role === 'mahalla' ? user.tuman_id : Number(tuman_id);

      if (!targetTumanId || !targetMahallaId || !String(address ?? '').trim()) {
        res.status(400).json({ error: 'Tuman, mahalla va obyekt manzili kiritilishi shart.' });
        return;
      }

      if (
        !canUserAccessRegion(user, {
          viloyat_id: user.viloyat_id ?? 1,
          tuman_id: targetTumanId,
          mahalla_id: targetMahallaId,
        })
      ) {
        res.status(403).json({ error: 'Siz faqat o‘zingizga biriktirilgan hududga obyekt kirita olasiz.' });
        return;
      }

      const mahallaRow = db
        .prepare('SELECT id, code, parent_id FROM regions WHERE id = ? AND level = ?')
        .get(targetMahallaId, 'mahalla') as { id: number; code: string; parent_id: number } | undefined;

      if (!mahallaRow || mahallaRow.parent_id !== targetTumanId) {
        res.status(400).json({ error: 'Tanlangan mahalla tumanga mos kelmadi.' });
        return;
      }

      const viloyatRow = db
        .prepare("SELECT id FROM regions WHERE level = 'viloyat' LIMIT 1")
        .get() as { id: number };

      const maxRow = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM properties').get() as {
        nextId: number;
      };
      const systemUid = `${mahallaRow.code}-${String(maxRow.nextId + 100).padStart(4, '0')}`;

      const hasCoords =
        latitude !== null &&
        latitude !== undefined &&
        latitude !== '' &&
        longitude !== null &&
        longitude !== undefined &&
        longitude !== '';
      const latNum = hasCoords ? Number(Number(latitude).toFixed(6)) : null;
      const lngNum = hasCoords ? Number(Number(longitude).toFixed(6)) : null;

      // Mahalla vakili cannot set confirmed cadastral status directly (TZ 3.3)
      const cadStatus: CadastralStatus = 'unverified';
      const defaultInsp = db
        .prepare("SELECT id FROM users WHERE role = 'inspector' AND tuman_id = ? AND is_blocked = 0 LIMIT 1")
        .get(targetTumanId) as { id: number } | undefined;

      const shouldInspect = request_inspection !== false;
      const inspStatus: InspectionStatus = shouldInspect
        ? defaultInsp
          ? 'assigned'
          : 'sent_for_inspection'
        : 'new';

      const sourceLabel =
        user.role === 'mahalla'
          ? 'Mahalla vakili xarita belgisi / xabarnomasi'
          : `${user.full_name} tomonidan kiritildi`;

      const validObjType: ObjectType = ['residential_house', 'land_parcel', 'auxiliary_building'].includes(
        object_type
      )
        ? object_type
        : 'residential_house';

      const parseOptInt = (v: any): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = Math.round(Number(v));
        return Number.isNaN(n) ? null : n;
      };
      const parseOptFloat = (v: any): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isNaN(n) ? null : Number(n.toFixed(2));
      };

      const tx = db.transaction(() => {
        const ins = db
          .prepare(
            `
            INSERT INTO properties (
              system_uid, viloyat_id, tuman_id, mahalla_id, address, address_code, parent_parcel_code,
              object_type, latitude, longitude, location_verified, cadastral_number,
              cadastral_status, inspection_status, source, source_date, assigned_user_id, notes,
              built_year, floors_count, rooms_count, land_area_m2, building_area_m2,
              wall_material, utilities_info, registration_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            systemUid,
            viloyatRow.id,
            targetTumanId,
            targetMahallaId,
            String(address).trim(),
            address_code ? String(address_code).trim() : null,
            parent_parcel_code ? String(parent_parcel_code).trim() : null,
            validObjType,
            latNum,
            lngNum,
            hasCoords ? 1 : 0,
            cadastral_number ? String(cadastral_number).trim() : null,
            cadStatus,
            inspStatus,
            sourceLabel,
            shouldInspect ? defaultInsp?.id ?? null : null,
            notes ? String(notes).trim() : null,
            parseOptInt(built_year),
            parseOptInt(floors_count),
            parseOptInt(rooms_count),
            parseOptFloat(land_area_m2),
            parseOptFloat(building_area_m2),
            wall_material ? String(wall_material).trim() : null,
            utilities_info ? String(utilities_info).trim() : null,
            registration_date ? String(registration_date).trim() : null
          );

        const propId = Number(ins.lastInsertRowid);

        if (shouldInspect) {
          const reason =
            String(inspection_reason ?? '').trim() ||
            (user.role === 'mahalla'
              ? 'Mahalla vakili tomonidan kadastr holati tekshiruv talab etuvchi obyekt sifatida xabar berildi'
              : 'Yangi kiritilgan obyektning kadastr holatini vakolatli manbadan tekshirish');

          db.prepare(
            `INSERT INTO tasks (property_id, assigned_to, created_by, reason, status, due_date)
             VALUES (?, ?, ?, ?, ?, date('now', '+7 days'))`
          ).run(propId, defaultInsp?.id ?? null, user.id, reason, inspStatus);

          if (defaultInsp) {
            createNotification({
              user_id: defaultInsp.id,
              title: 'Yangi obyekt tekshiruvga yuborildi',
              message: `${systemUid} (${String(address).trim()}) obyekti bo‘yicha tekshiruv topshirig‘i biriktirildi.`,
              entity_type: 'property',
              entity_id: propId,
            });
          }
        }

        writeAuditLog({
          actor_id: user.id,
          actor_name: user.full_name,
          actor_role: user.role,
          action: 'PROPERTY_CREATED',
          entity_type: 'properties',
          entity_id: systemUid,
          property_id: propId,
          summary: `Yangi obyekt kiritildi: ${systemUid} (${String(address).trim()}).`,
          ip_address: req.ip,
        });

        return propId;
      });

      const createdId = tx();
      const createdRow = db.prepare('SELECT * FROM properties WHERE id = ?').get(createdId) as Record<
        string,
        any
      >;
      res.status(201).json(enrichProperty(createdRow));
    } catch (err: any) {
      console.error('Create property error:', err);
      res.status(500).json({ error: 'Obyektni saqlashda xatolik yuz berdi.' });
    }
  });

  // Update non-official metadata or forbid unauthorized cadastre tampering (TZ 3.3 & 16)
  app.patch('/api/properties/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as
      | Record<string, any>
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Obyekt topilmadi.' });
      return;
    }

    if (
      !canUserAccessRegion(user, {
        viloyat_id: existing.viloyat_id,
        tuman_id: existing.tuman_id,
        mahalla_id: existing.mahalla_id,
      })
    ) {
      res.status(403).json({ error: 'Boshqa hudud obyektini o‘zgartirish taqiqlanadi.' });
      return;
    }

    // Explicitly block Mahalla rep from attempting to alter official cadastral_status
    if (req.body.cadastral_status && !canUserConfirmOfficialCadastre(user)) {
      writeAuditLog({
        actor_id: user.id,
        actor_name: user.full_name,
        actor_role: user.role,
        action: 'UNAUTHORIZED_CADASTRE_CHANGE_BLOCKED',
        entity_type: 'properties',
        entity_id: existing.system_uid,
        property_id: id,
        summary: `Mahalla vakilining rasmiy kadastr holatini o‘zgartirish urinishi server tomonidan rad etildi.`,
        ip_address: req.ip,
      });
      res.status(403).json({
        error: 'Mahalla vakili rasmiy tasdiqlangan kadastr holatini o‘zboshimchalik bilan o‘zgartira olmaydi.',
      });
      return;
    }

    const parsePatchInt = (val: any, fallback: number | null): number | null => {
      if (val === undefined) return fallback;
      if (val === null || val === '') return null;
      const n = Math.round(Number(val));
      return Number.isNaN(n) ? fallback : n;
    };
    const parsePatchFloat = (val: any, fallback: number | null): number | null => {
      if (val === undefined) return fallback;
      if (val === null || val === '') return null;
      const n = Number(val);
      return Number.isNaN(n) ? fallback : Number(n.toFixed(2));
    };
    const parsePatchStr = (val: any, fallback: string | null): string | null => {
      if (val === undefined) return fallback;
      if (val === null || String(val).trim() === '') return null;
      return String(val).trim();
    };

    const newAddress = req.body.address !== undefined ? String(req.body.address).trim() : existing.address;
    const newAddressCode = parsePatchStr(req.body.address_code, existing.address_code);
    const newNotes = parsePatchStr(req.body.notes, existing.notes);
    const newBuiltYear = parsePatchInt(req.body.built_year, existing.built_year ?? null);
    const newFloors = parsePatchInt(req.body.floors_count, existing.floors_count ?? null);
    const newRooms = parsePatchInt(req.body.rooms_count, existing.rooms_count ?? null);
    const newLandArea = parsePatchFloat(req.body.land_area_m2, existing.land_area_m2 ?? null);
    const newBuildArea = parsePatchFloat(req.body.building_area_m2, existing.building_area_m2 ?? null);
    const newWallMat = parsePatchStr(req.body.wall_material, existing.wall_material ?? null);
    const newUtilities = parsePatchStr(req.body.utilities_info, existing.utilities_info ?? null);
    const newRegDate = parsePatchStr(req.body.registration_date, existing.registration_date ?? null);

    const newAssigned =
      user.role === 'admin' && req.body.assigned_user_id !== undefined
        ? req.body.assigned_user_id
          ? Number(req.body.assigned_user_id)
          : null
        : existing.assigned_user_id;

    db.prepare(
      `UPDATE properties
       SET address = ?, address_code = ?, notes = ?, assigned_user_id = ?,
           built_year = ?, floors_count = ?, rooms_count = ?,
           land_area_m2 = ?, building_area_m2 = ?, wall_material = ?,
           utilities_info = ?, registration_date = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      newAddress,
      newAddressCode,
      newNotes,
      newAssigned,
      newBuiltYear,
      newFloors,
      newRooms,
      newLandArea,
      newBuildArea,
      newWallMat,
      newUtilities,
      newRegDate,
      id
    );

    writeAuditLog({
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'PROPERTY_UPDATED',
      entity_type: 'properties',
      entity_id: existing.system_uid,
      property_id: id,
      summary: `${existing.system_uid} obyekti va uy-joy texnik pasport ma’lumotlari yangilandi.`,
      changes: {
        address: existing.address !== newAddress ? { from: existing.address, to: newAddress } : undefined,
        built_year: existing.built_year !== newBuiltYear ? { from: existing.built_year, to: newBuiltYear } : undefined,
        land_area_m2: existing.land_area_m2 !== newLandArea ? { from: existing.land_area_m2, to: newLandArea } : undefined,
        building_area_m2:
          existing.building_area_m2 !== newBuildArea
            ? { from: existing.building_area_m2, to: newBuildArea }
            : undefined,
        notes: existing.notes !== newNotes ? { from: existing.notes, to: newNotes } : undefined,
      },
      ip_address: req.ip,
    });

    const updated = db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as Record<string, any>;
    res.json(enrichProperty(updated));
  });

  // Coordinate Update / Correction Workflow (TZ Section 6)
  app.post('/api/properties/:id/location', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as
      | Record<string, any>
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Obyekt topilmadi.' });
      return;
    }
    if (
      !canUserAccessRegion(user, {
        viloyat_id: existing.viloyat_id,
        tuman_id: existing.tuman_id,
        mahalla_id: existing.mahalla_id,
      })
    ) {
      res.status(403).json({ error: 'Ushbu hudud obyektiga ruxsat yo‘q.' });
      return;
    }

    const lat = Number(req.body?.latitude);
    const lng = Number(req.body?.longitude);
    const note = String(req.body?.note ?? '').trim();

    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < 37 || lat > 45.7 || lng < 55.9 || lng > 73.3) {
      res.status(400).json({ error: 'Kiritilgan koordinatalar O‘zbekiston hududiga mos emas.' });
      return;
    }

    if (user.role === 'admin' || user.role === 'inspector') {
      db.prepare(
        `UPDATE properties
         SET latitude = ?, longitude = ?, location_verified = 1,
             pending_lat = NULL, pending_lng = NULL, pending_location_note = NULL, pending_location_by = NULL,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(Number(lat.toFixed(6)), Number(lng.toFixed(6)), id);

      writeAuditLog({
        actor_id: user.id,
        actor_name: user.full_name,
        actor_role: user.role,
        action: 'LOCATION_CONFIRMED',
        entity_type: 'properties',
        entity_id: existing.system_uid,
        property_id: id,
        summary: `${existing.system_uid} obyekti koordinatalari yangilandi: (${lat.toFixed(6)}, ${lng.toFixed(6)}). ${note}`,
        changes: {
          latitude: { from: existing.latitude, to: Number(lat.toFixed(6)) },
          longitude: { from: existing.longitude, to: Number(lng.toFixed(6)) },
        },
        ip_address: req.ip,
      });
    } else {
      // Mahalla representative: if completely unlocated, set coordinates AND keep/flag for review; if already located, submit correction request!
      if (!existing.latitude || !existing.longitude) {
        db.prepare(
          `UPDATE properties
           SET latitude = ?, longitude = ?, location_verified = 1,
               pending_location_note = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(Number(lat.toFixed(6)), Number(lng.toFixed(6)), note || null, id);

        writeAuditLog({
          actor_id: user.id,
          actor_name: user.full_name,
          actor_role: user.role,
          action: 'INITIAL_LOCATION_PINNED',
          entity_type: 'properties',
          entity_id: existing.system_uid,
          property_id: id,
          summary: `Mahalla vakili koordinatasi bo‘lmagan ${existing.system_uid} obyektini xaritada belgiladi: (${lat.toFixed(6)}, ${lng.toFixed(6)}).`,
          ip_address: req.ip,
        });
      } else {
        db.prepare(
          `UPDATE properties
           SET pending_lat = ?, pending_lng = ?, pending_location_note = ?, pending_location_by = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          Number(lat.toFixed(6)),
          Number(lng.toFixed(6)),
          note || 'Xaritadagi joylashuvni aniqlashtirish so‘rovi',
          user.id,
          id
        );

        writeAuditLog({
          actor_id: user.id,
          actor_name: user.full_name,
          actor_role: user.role,
          action: 'LOCATION_CORRECTION_REQUESTED',
          entity_type: 'properties',
          entity_id: existing.system_uid,
          property_id: id,
          summary: `${existing.system_uid} obyekti joylashuvini tuzatish uchun vakolatli tasdiqqa yuborildi: (${lat.toFixed(6)}, ${lng.toFixed(6)}).`,
          ip_address: req.ip,
        });
      }
    }

    const updated = db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as Record<string, any>;
    res.json(enrichProperty(updated));
  });

  app.post(
    '/api/properties/:id/location/resolve',
    requireAuth,
    requireRoles('admin', 'inspector'),
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const id = Number(req.params.id);
      const approve = Boolean(req.body?.approve);

      const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as
        | Record<string, any>
        | undefined;
      if (!existing || existing.pending_lat === null) {
        res.status(400).json({ error: 'Ko‘rib chiqiladigan joylashuv so‘rovi topilmadi.' });
        return;
      }

      if (approve) {
        db.prepare(
          `UPDATE properties
           SET latitude = pending_lat, longitude = pending_lng, location_verified = 1,
               pending_lat = NULL, pending_lng = NULL, pending_location_note = NULL, pending_location_by = NULL,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(id);

        writeAuditLog({
          actor_id: user.id,
          actor_name: user.full_name,
          actor_role: user.role,
          action: 'LOCATION_CORRECTION_APPROVED',
          entity_type: 'properties',
          entity_id: existing.system_uid,
          property_id: id,
          summary: `${existing.system_uid} obyekti bo‘yicha joylashuvni tuzatish so‘rovi tasdiqlandi.`,
          changes: {
            latitude: { from: existing.latitude, to: existing.pending_lat },
            longitude: { from: existing.longitude, to: existing.pending_lng },
          },
          ip_address: req.ip,
        });
      } else {
        db.prepare(
          `UPDATE properties
           SET pending_lat = NULL, pending_lng = NULL, pending_location_note = NULL, pending_location_by = NULL,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(id);

        writeAuditLog({
          actor_id: user.id,
          actor_name: user.full_name,
          actor_role: user.role,
          action: 'LOCATION_CORRECTION_REJECTED',
          entity_type: 'properties',
          entity_id: existing.system_uid,
          property_id: id,
          summary: `${existing.system_uid} obyekti bo‘yicha joylashuvni tuzatish so‘rovi rad etildi.`,
          ip_address: req.ip,
        });
      }

      const updated = db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as Record<string, any>;
      res.json(enrichProperty(updated));
    }
  );

  // Official Cadastral Status Confirmation (Admin or Inspector in scope ONLY — TZ Section 9)
  app.post(
    '/api/properties/:id/confirm-cadastre',
    requireAuth,
    requireRoles('admin', 'inspector'),
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as
        | Record<string, any>
        | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Obyekt topilmadi.' });
        return;
      }
      if (
        !canUserAccessRegion(user, {
          viloyat_id: existing.viloyat_id,
          tuman_id: existing.tuman_id,
          mahalla_id: existing.mahalla_id,
        })
      ) {
        res.status(403).json({ error: 'Boshqa tuman obyektini tasdiqlash huquqingiz yo‘q.' });
        return;
      }

      const newCadStatus = String(req.body?.cadastral_status ?? '') as CadastralStatus;
      const cadastralNumber = req.body?.cadastral_number
        ? String(req.body.cadastral_number).trim()
        : null;
      const authoritySource = String(req.body?.authority_source ?? '').trim();
      const comment = String(req.body?.comment ?? '').trim();

      if (!['confirmed', 'confirmed_absent', 'unverified'].includes(newCadStatus)) {
        res.status(400).json({ error: 'Noto‘g‘ri kadastr holati tanlandi.' });
        return;
      }
      if (!authoritySource || !comment) {
        res.status(400).json({
          error: 'Rasmiy holatni tasdiqlash uchun vakolatli manba va asoslantiruvchi izoh kiritilishi shart.',
        });
        return;
      }
      if (newCadStatus === 'confirmed' && !cadastralNumber && !existing.cadastral_number) {
        res.status(400).json({
          error: 'Kadastr holatini "Tasdiqlangan" deb belgilash uchun kadastr raqami ko‘rsatilishi shart.',
        });
        return;
      }

      const finalCadNum =
        newCadStatus === 'confirmed_absent'
          ? null
          : cadastralNumber || existing.cadastral_number;

      const finalInspStatus: InspectionStatus =
        newCadStatus === 'unverified' ? 'reopened' : 'completed';

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE properties
           SET cadastral_status = ?,
               cadastral_number = ?,
               inspection_status = ?,
               source = ?,
               last_inspected_at = datetime('now'),
               notes = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(newCadStatus, finalCadNum, finalInspStatus, authoritySource, comment, id);

        if (newCadStatus === 'confirmed' && finalCadNum) {
          db.prepare(
            `INSERT INTO cadastral_records (property_id, cadastral_number, source_authority, verification_doc_ref)
             VALUES (?, ?, ?, ?)`
          ).run(id, finalCadNum, authoritySource, `VER-${Date.now()}`);
        }

        db.prepare(
          `INSERT INTO inspections (
            property_id, inspector_id, cadastral_number_checked, authority_source,
            proposed_cadastral_status, inspection_outcome, comment, inspected_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          id,
          user.id,
          finalCadNum,
          authoritySource,
          newCadStatus,
          finalInspStatus === 'completed' ? 'completed' : 'reopened',
          comment
        );

        // Sync open tasks on this property if completed
        if (finalInspStatus === 'completed') {
          db.prepare(
            `UPDATE tasks
             SET status = 'completed', result_summary = ?, completed_at = datetime('now'), updated_at = datetime('now')
             WHERE property_id = ? AND status != 'completed'`
          ).run(comment, id);
        }

        writeAuditLog({
          actor_id: user.id,
          actor_name: user.full_name,
          actor_role: user.role,
          action: 'OFFICIAL_CADASTRE_DECISION',
          entity_type: 'properties',
          entity_id: existing.system_uid,
          property_id: id,
          summary: `${existing.system_uid}: Kadastr holati "${CADASTRAL_STATUS_LABELS[newCadStatus]}" etib tasdiqlandi (${authoritySource}).`,
          changes: {
            cadastral_status: { from: existing.cadastral_status, to: newCadStatus },
            cadastral_number: { from: existing.cadastral_number, to: finalCadNum },
            comment,
          },
          ip_address: req.ip,
        });
      });

      tx();
      const updated = db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as Record<string, any>;
      res.json(enrichProperty(updated));
    }
  );

  // Safe Attachment Upload (TZ Section 7 & 14)
  app.post('/api/properties/:id/attachments', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as
      | Record<string, any>
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Obyekt topilmadi.' });
      return;
    }
    if (
      !canUserAccessRegion(user, {
        viloyat_id: existing.viloyat_id,
        tuman_id: existing.tuman_id,
        mahalla_id: existing.mahalla_id,
      })
    ) {
      res.status(403).json({ error: 'Ruxsat rad etildi.' });
      return;
    }

    const docTitle = String(req.body?.doc_title ?? '').trim();
    const docNumber = req.body?.doc_number ? String(req.body.doc_number).trim() : null;
    const fileName = String(req.body?.file_name ?? '').trim();
    const mimeType = String(req.body?.mime_type ?? 'application/pdf').trim();
    const fileSize = Number(req.body?.file_size ?? 0);
    const dataUrl = req.body?.data_url ? String(req.body.data_url) : null;

    if (!docTitle || !fileName) {
      res.status(400).json({ error: 'Hujjat nomi va fayl ko‘rsatilishi shart.' });
      return;
    }

    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowedMimes.includes(mimeType)) {
      res.status(400).json({
        error: 'Faqat PDF, JPG, PNG, WEBP yoki Word formatidagi rasmiy hujjatlar qabul qilinadi.',
      });
      return;
    }

    if (fileSize > 2.5 * 1024 * 1024) {
      res.status(400).json({ error: 'Fayl hajmi 2.5 MB dan oshmasligi lozim.' });
      return;
    }

    const ins = db
      .prepare(
        `INSERT INTO attachments (
          property_id, task_id, doc_title, doc_number, file_name, mime_type, file_size, data_url, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        req.body?.task_id ? Number(req.body.task_id) : null,
        docTitle,
        docNumber,
        fileName,
        mimeType,
        fileSize,
        dataUrl,
        user.id
      );

    writeAuditLog({
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'ATTACHMENT_ADDED',
      entity_type: 'attachments',
      entity_id: Number(ins.lastInsertRowid),
      property_id: id,
      summary: `${existing.system_uid} obyektiga hujjat biriktirildi: "${docTitle}" (${fileName}).`,
      ip_address: req.ip,
    });

    const created = db
      .prepare('SELECT * FROM attachments WHERE id = ?')
      .get(Number(ins.lastInsertRowid));
    res.status(201).json(created);
  });

  // ============================================================================
  // 5. INSPECTION TASKS WORKFLOW (TZ Section 10)
  // ============================================================================
  app.get('/api/tasks', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const scope = buildPropertyScopeClause(user, 'p');

    const status = String(req.query.status ?? '').trim();
    const assignedOnly = req.query.assignedToMe === 'true';
    const overdueOnly = req.query.overdue === 'true';
    const q = String(req.query.q ?? '').trim();

    const clauses: string[] = [scope.sql];
    const params: (string | number)[] = [...scope.params];

    if (status) {
      clauses.push('tk.status = ?');
      params.push(status);
    }
    if (assignedOnly) {
      clauses.push('tk.assigned_to = ?');
      params.push(user.id);
    }
    if (overdueOnly) {
      clauses.push("tk.status != 'completed' AND tk.due_date IS NOT NULL AND tk.due_date < date('now')");
    }
    if (q) {
      clauses.push('(p.system_uid LIKE ? OR p.address LIKE ? OR tk.reason LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const tasks = db
      .prepare(
        `
        SELECT
          tk.*,
          p.system_uid,
          p.address as property_address,
          p.cadastral_status,
          p.cadastral_number,
          p.latitude,
          p.longitude,
          t.name as tuman_name,
          m.name as mahalla_name,
          u.full_name as assigned_to_name,
          cu.full_name as created_by_name
        FROM tasks tk
        JOIN properties p ON p.id = tk.property_id
        JOIN regions t ON t.id = p.tuman_id
        JOIN regions m ON m.id = p.mahalla_id
        LEFT JOIN users u ON u.id = tk.assigned_to
        LEFT JOIN users cu ON cu.id = tk.created_by
        WHERE ${clauses.join(' AND ')}
        ORDER BY
          CASE WHEN tk.status = 'completed' THEN 1 ELSE 0 END ASC,
          tk.due_date ASC,
          tk.id DESC
        LIMIT 200
      `
      )
      .all(...params);

    res.json(tasks);
  });

  app.post('/api/tasks', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const propertyId = Number(req.body?.property_id);
    const assignedTo = req.body?.assigned_to ? Number(req.body.assigned_to) : null;
    const reason = String(req.body?.reason ?? '').trim();
    const dueDate = req.body?.due_date ? String(req.body.due_date) : null;

    if (!propertyId || !reason) {
      res.status(400).json({ error: 'Obyekt va tekshiruv sababi ko‘rsatilishi shart.' });
      return;
    }

    const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId) as
      | Record<string, any>
      | undefined;
    if (!prop) {
      res.status(404).json({ error: 'Obyekt topilmadi.' });
      return;
    }
    if (
      !canUserAccessRegion(user, {
        viloyat_id: prop.viloyat_id,
        tuman_id: prop.tuman_id,
        mahalla_id: prop.mahalla_id,
      })
    ) {
      res.status(403).json({ error: 'Boshqa hudud obyekti bo‘yicha topshiriq yarata olmaysiz.' });
      return;
    }

    let targetAssignee = assignedTo;
    if (!targetAssignee) {
      const autoInsp = db
        .prepare("SELECT id FROM users WHERE role = 'inspector' AND tuman_id = ? AND is_blocked = 0 LIMIT 1")
        .get(prop.tuman_id) as { id: number } | undefined;
      targetAssignee = autoInsp?.id ?? null;
    }

    const initialStatus: InspectionStatus = targetAssignee ? 'assigned' : 'sent_for_inspection';

    const tx = db.transaction(() => {
      const ins = db
        .prepare(
          `INSERT INTO tasks (property_id, assigned_to, created_by, reason, status, due_date)
           VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now', '+7 days')))`
        )
        .run(propertyId, targetAssignee, user.id, reason, initialStatus, dueDate);

      db.prepare(
        `UPDATE properties
         SET inspection_status = ?, assigned_user_id = COALESCE(?, assigned_user_id), updated_at = datetime('now')
         WHERE id = ?`
      ).run(initialStatus, targetAssignee, propertyId);

      const taskId = Number(ins.lastInsertRowid);

      if (targetAssignee) {
        createNotification({
          user_id: targetAssignee,
          title: 'Yangi tekshiruv topshirig‘i',
          message: `${prop.system_uid} (${prop.address}) obyekti bo‘yicha topshiriq biriktirildi.`,
          entity_type: 'task',
          entity_id: taskId,
        });
      }

      writeAuditLog({
        actor_id: user.id,
        actor_name: user.full_name,
        actor_role: user.role,
        action: 'TASK_CREATED',
        entity_type: 'tasks',
        entity_id: taskId,
        property_id: propertyId,
        summary: `${prop.system_uid} obyekti bo‘yicha #${taskId} tekshiruv topshirig‘i yaratildi: "${reason}".`,
        ip_address: req.ip,
      });

      return taskId;
    });

    const taskId = tx();
    const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    res.status(201).json(created);
  });

  app.post(
    '/api/tasks/:id/accept',
    requireAuth,
    requireRoles('admin', 'inspector'),
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const taskId = Number(req.params.id);
      const task = db
        .prepare(
          `SELECT tk.*, p.system_uid, p.viloyat_id, p.tuman_id, p.mahalla_id
           FROM tasks tk JOIN properties p ON p.id = tk.property_id
           WHERE tk.id = ?`
        )
        .get(taskId) as Record<string, any> | undefined;

      if (!task) {
        res.status(404).json({ error: 'Topshiriq topilmadi.' });
        return;
      }
      if (!canUserAccessRegion(user, task)) {
        res.status(403).json({ error: 'Boshqa hudud topshirig‘ini qabul qila olmaysiz.' });
        return;
      }

      const assignee = user.role === 'inspector' ? user.id : task.assigned_to ?? user.id;

      db.prepare(
        `UPDATE tasks SET status = 'in_progress', assigned_to = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(assignee, taskId);

      db.prepare(
        `UPDATE properties SET inspection_status = 'in_progress', assigned_user_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(assignee, task.property_id);

      writeAuditLog({
        actor_id: user.id,
        actor_name: user.full_name,
        actor_role: user.role,
        action: 'TASK_ACCEPTED',
        entity_type: 'tasks',
        entity_id: taskId,
        property_id: task.property_id,
        summary: `#${taskId} topshiriq (${task.system_uid}) ijroga qabul qilindi ("Tekshirilmoqda").`,
        ip_address: req.ip,
      });

      res.json({ ok: true });
    }
  );

  // Submit Inspection Result or Return for Extra Info / Reopen Completed Task (TZ Section 9 & 10)
  app.post(
    '/api/tasks/:id/inspect',
    requireAuth,
    requireRoles('admin', 'inspector'),
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const taskId = Number(req.params.id);

      const task = db
        .prepare(
          `SELECT tk.*, p.system_uid, p.cadastral_status as old_cad_status, p.cadastral_number as old_cad_num,
                  p.viloyat_id, p.tuman_id, p.mahalla_id
           FROM tasks tk
           JOIN properties p ON p.id = tk.property_id
           WHERE tk.id = ?`
        )
        .get(taskId) as Record<string, any> | undefined;

      if (!task) {
        res.status(404).json({ error: 'Topshiriq topilmadi.' });
        return;
      }
      if (!canUserAccessRegion(user, task)) {
        res.status(403).json({ error: 'Boshqa hudud topshirig‘iga natija kirita olmaysiz.' });
        return;
      }

      const outcome = String(req.body?.outcome ?? 'completed') as
        | 'completed'
        | 'needs_info'
        | 'reopened';
      const cadastralStatus = String(
        req.body?.cadastral_status ?? 'unverified'
      ) as CadastralStatus;
      const cadastralNumber = req.body?.cadastral_number
        ? String(req.body.cadastral_number).trim()
        : null;
      const authoritySource = String(req.body?.authority_source ?? '').trim();
      const comment = String(req.body?.comment ?? '').trim();
      const reopenReason = String(req.body?.reopen_reason ?? '').trim();

      if (!authoritySource || !comment) {
        res.status(400).json({ error: 'Vakolatli tekshiruv manbasi va izohni kiritish shart.' });
        return;
      }

      // TZ Section 10: Modifying/reopening an already completed task requires an explicit reason!
      if (task.status === 'completed' && !reopenReason) {
        res.status(400).json({
          error:
            'Yakunlangan topshiriqni o‘zgartirish yoki qayta tekshiruvga yuborish uchun sabab ko‘rsatilishi shart.',
        });
        return;
      }

      if (outcome === 'completed' && cadastralStatus === 'confirmed' && !cadastralNumber && !task.old_cad_num) {
        res.status(400).json({
          error: '"Tasdiqlangan" holati uchun kadastr raqamini ko‘rsatish majburiy.',
        });
        return;
      }

      // TZ Section 9: If inspection is NOT completed (e.g., needs_info or reopened), cadastral_status stays unverified!
      const effectiveCadStatus: CadastralStatus =
        outcome === 'completed' ? cadastralStatus : 'unverified';
      const effectiveCadNum =
        effectiveCadStatus === 'confirmed_absent'
          ? null
          : cadastralNumber || task.old_cad_num;

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE tasks
           SET status = ?,
               result_summary = ?,
               reopen_reason = COALESCE(?, reopen_reason),
               completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(outcome, comment, reopenReason || null, outcome, taskId);

        db.prepare(
          `UPDATE properties
           SET cadastral_status = ?,
               cadastral_number = ?,
               inspection_status = ?,
               source = ?,
               last_inspected_at = datetime('now'),
               notes = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          effectiveCadStatus,
          effectiveCadNum,
          outcome,
          authoritySource,
          comment,
          task.property_id
        );

        db.prepare(
          `INSERT INTO inspections (
            property_id, task_id, inspector_id, cadastral_number_checked, authority_source,
            proposed_cadastral_status, inspection_outcome, comment, inspected_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          task.property_id,
          taskId,
          user.id,
          effectiveCadNum,
          authoritySource,
          effectiveCadStatus,
          outcome,
          comment
        );

        if (outcome === 'completed' && effectiveCadStatus === 'confirmed' && effectiveCadNum) {
          db.prepare(
            `INSERT INTO cadastral_records (property_id, cadastral_number, source_authority, verification_doc_ref)
             VALUES (?, ?, ?, ?)`
          ).run(task.property_id, effectiveCadNum, authoritySource, `TASK-${taskId}`);
        }

        writeAuditLog({
          actor_id: user.id,
          actor_name: user.full_name,
          actor_role: user.role,
          action: task.status === 'completed' ? 'COMPLETED_TASK_MODIFIED' : 'TASK_INSPECTED',
          entity_type: 'tasks',
          entity_id: taskId,
          property_id: task.property_id,
          summary: `#${taskId} topshiriq (${task.system_uid}): Tekshiruv holati "${INSPECTION_STATUS_LABELS[outcome]}", Kadastr holati "${CADASTRAL_STATUS_LABELS[effectiveCadStatus]}".${reopenReason ? ` O‘zgartirish sababi: ${reopenReason}` : ''}`,
          changes: {
            task_status: { from: task.status, to: outcome },
            cadastral_status: { from: task.old_cad_status, to: effectiveCadStatus },
            reopen_reason: reopenReason || undefined,
          },
          ip_address: req.ip,
        });
      });

      tx();
      res.json({ ok: true });
    }
  );

  // ============================================================================
  // 6. EXCEL MASS IMPORT (Admin — TZ Section 8)
  // ============================================================================
  app.get('/api/imports', requireAuth, requireRoles('admin'), (_req: AuthedRequest, res: Response) => {
    const imports = db
      .prepare(
        `SELECT i.*, u.full_name as uploaded_by_name
         FROM imports i
         LEFT JOIN users u ON u.id = i.uploaded_by
         ORDER BY i.id DESC LIMIT 50`
      )
      .all();
    res.json(imports);
  });

  app.get(
    '/api/imports/template.xlsx',
    requireAuth,
    requireRoles('admin'),
    (req: AuthedRequest, res: Response) => {
      const mode = req.query.mode === 'clean' ? 'clean' : 'sample';
      const buf = generateSampleExcelBuffer(mode);
      const fname =
        mode === 'clean'
          ? 'ekadastr_shablon_bosh.xlsx'
          : 'ekadastr_andijon_sinov_namuna.xlsx';
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      res.send(buf);
    }
  );

  app.post(
    '/api/imports/preview',
    requireAuth,
    requireRoles('admin'),
    (req: AuthedRequest, res: Response) => {
      try {
        const filename = String(req.body?.filename ?? '').trim();
        const base64Data = String(req.body?.fileBase64 ?? '').trim();

        if (!filename || !base64Data) {
          res.status(400).json({ error: 'Excel fayli tanlanmagan.' });
          return;
        }
        if (!/\.(xlsx|xls|csv)$/i.test(filename)) {
          res.status(400).json({
            error: 'Faqat .xlsx, .xls yoki .csv formatidagi jadval fayllari qabul qilinadi.',
          });
          return;
        }

        const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        const buffer = Buffer.from(cleanBase64, 'base64');
        if (buffer.length > 8 * 1024 * 1024) {
          res.status(400).json({ error: 'Excel fayli hajmi 8 MB dan oshmasligi kerak.' });
          return;
        }

        const preview = previewExcelBuffer(buffer, filename, req.user!);
        res.json(preview);
      } catch (err: any) {
        console.error('Excel preview error:', err);
        res.status(400).json({ error: err.message || 'Excel faylini o‘qishda xatolik yuz berdi.' });
      }
    }
  );

  app.post(
    '/api/imports/commit',
    requireAuth,
    requireRoles('admin'),
    (req: AuthedRequest, res: Response) => {
      try {
        const previewToken = String(req.body?.previewToken ?? '');
        if (!previewToken) {
          res.status(400).json({ error: 'Preview token topilmadi.' });
          return;
        }
        const result = commitExcelPreview(previewToken, req.user!);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Importni tasdiqlashda xatolik.' });
      }
    }
  );

  // ============================================================================
  // 7. USER MANAGEMENT & INSPECTOR DIRECTORY (TZ Section 3.1)
  // ============================================================================
  app.get('/api/inspectors', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const inspectors = db
      .prepare(
        `SELECT u.id, u.full_name, u.tuman_id, t.name as tuman_name
         FROM users u
         LEFT JOIN regions t ON t.id = u.tuman_id
         WHERE u.role = 'inspector' AND u.is_blocked = 0
         ${user.role !== 'admin' && user.tuman_id ? 'AND u.tuman_id = ?' : ''}
         ORDER BY u.full_name`
      )
      .all(...(user.role !== 'admin' && user.tuman_id ? [user.tuman_id] : []));
    res.json(inspectors);
  });

  app.get('/api/users', requireAuth, requireRoles('admin'), (_req: AuthedRequest, res: Response) => {
    const users = db
      .prepare(
        `SELECT
           u.id, u.username, u.full_name, u.role, u.phone, u.position,
           u.viloyat_id, u.tuman_id, u.mahalla_id, u.is_blocked, u.last_login_at, u.created_at,
           v.name as viloyat_name, t.name as tuman_name, m.name as mahalla_name
         FROM users u
         LEFT JOIN regions v ON v.id = u.viloyat_id
         LEFT JOIN regions t ON t.id = u.tuman_id
         LEFT JOIN regions m ON m.id = u.mahalla_id
         ORDER BY u.id ASC`
      )
      .all();
    res.json(users);
  });

  app.post('/api/users', requireAuth, requireRoles('admin'), (req: AuthedRequest, res: Response) => {
    try {
      const {
        username,
        password,
        full_name,
        role,
        phone,
        position,
        viloyat_id,
        tuman_id,
        mahalla_id,
      } = req.body;

      if (!username || !password || !full_name || !role) {
        res.status(400).json({ error: 'Login, parol, F.I.Sh va rol majburiy.' });
        return;
      }
      if (String(password).length < 6) {
        res.status(400).json({ error: 'Parol kamida 6 ta belgidan iborat bo‘lishi shart.' });
        return;
      }
      if (role === 'inspector' && !tuman_id) {
        res.status(400).json({ error: 'Kadastr xodimiga tuman biriktirilishi shart.' });
        return;
      }
      if (role === 'mahalla' && (!tuman_id || !mahalla_id)) {
        res.status(400).json({ error: 'Mahalla vakiliga tuman va aniq mahalla biriktirilishi shart.' });
        return;
      }

      const defaultVil =
        viloyat_id ||
        (db.prepare("SELECT id FROM regions WHERE level = 'viloyat' LIMIT 1").get() as { id: number })
          ?.id ||
        1;

      const ins = db
        .prepare(
          `INSERT INTO users (
            username, password_hash, full_name, role, phone, position, viloyat_id, tuman_id, mahalla_id, is_blocked
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
        )
        .run(
          String(username).trim(),
          hashPassword(String(password)),
          String(full_name).trim(),
          role,
          phone ? String(phone).trim() : null,
          position ? String(position).trim() : null,
          Number(defaultVil),
          tuman_id ? Number(tuman_id) : null,
          mahalla_id ? Number(mahalla_id) : null
        );

      const newId = Number(ins.lastInsertRowid);
      writeAuditLog({
        actor_id: req.user!.id,
        actor_name: req.user!.full_name,
        actor_role: req.user!.role,
        action: 'USER_CREATED',
        entity_type: 'users',
        entity_id: String(username).trim(),
        summary: `Yangi foydalanuvchi yaratildi: ${full_name} (login: ${username}, rol: ${role}).`,
        ip_address: req.ip,
      });

      res.status(201).json(getUserById(newId));
    } catch (err: any) {
      res.status(400).json({
        error: err.message?.includes('UNIQUE')
          ? 'Ushbu login band — boshqa login tanlang.'
          : 'Foydalanuvchi yaratishda xatolik.',
      });
    }
  });

  app.patch(
    '/api/users/:id',
    requireAuth,
    requireRoles('admin'),
    (req: AuthedRequest, res: Response) => {
      const targetId = Number(req.params.id);
      const existing = getUserById(targetId);
      if (!existing) {
        res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
        return;
      }

      if (targetId === req.user!.id && req.body.is_blocked === 1) {
        res.status(400).json({ error: 'O‘z administrator hisobingizni bloklay olmaysiz.' });
        return;
      }

      const newRole = (req.body.role ?? existing.role) as UserRole;
      const newBlocked =
        req.body.is_blocked !== undefined ? (req.body.is_blocked ? 1 : 0) : existing.is_blocked;
      const newTuman =
        req.body.tuman_id !== undefined
          ? req.body.tuman_id
            ? Number(req.body.tuman_id)
            : null
          : existing.tuman_id;
      const newMahalla =
        req.body.mahalla_id !== undefined
          ? req.body.mahalla_id
            ? Number(req.body.mahalla_id)
            : null
          : existing.mahalla_id;
      const newFullName = req.body.full_name
        ? String(req.body.full_name).trim()
        : existing.full_name;
      const newPosition =
        req.body.position !== undefined
          ? req.body.position
            ? String(req.body.position).trim()
            : null
          : existing.position;

      db.prepare(
        `UPDATE users
         SET full_name = ?, role = ?, position = ?, tuman_id = ?, mahalla_id = ?, is_blocked = ?
         WHERE id = ?`
      ).run(newFullName, newRole, newPosition, newTuman, newMahalla, newBlocked, targetId);

      if (req.body.new_password && String(req.body.new_password).length >= 6) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
          hashPassword(String(req.body.new_password)),
          targetId
        );
      }

      if (newBlocked === 1) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
      }

      writeAuditLog({
        actor_id: req.user!.id,
        actor_name: req.user!.full_name,
        actor_role: req.user!.role,
        action: newBlocked !== existing.is_blocked
          ? newBlocked
            ? 'USER_BLOCKED'
            : 'USER_UNBLOCKED'
          : 'USER_UPDATED',
        entity_type: 'users',
        entity_id: existing.username,
        summary: `Foydalanuvchi "${existing.username}" ma’lumotlari yangilandi (rol: ${newRole}, holat: ${newBlocked ? 'Bloklangan' : 'Faol'}).`,
        ip_address: req.ip,
      });

      res.json(getUserById(targetId));
    }
  );

  // ============================================================================
  // 8. AUDIT LOGS, NOTIFICATIONS, BACKUP & QA TESTS (TZ Sections 12, 14, 16)
  // ============================================================================
  app.get('/api/notifications', requireAuth, (req: AuthedRequest, res: Response) => {
    const items = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30')
      .all(req.user!.id);
    res.json(items);
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res: Response) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    res.json({ ok: true });
  });

  app.get(
    '/api/audit-logs',
    requireAuth,
    requireRoles('admin'),
    (req: AuthedRequest, res: Response) => {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = Math.min(50, Math.max(10, Number(req.query.pageSize ?? 20)));
      const offset = (page - 1) * pageSize;
      const q = String(req.query.q ?? '').trim();
      const actionFilter = String(req.query.action ?? '').trim();

      const clauses: string[] = ['1 = 1'];
      const params: (string | number)[] = [];

      if (q) {
        clauses.push('(actor_name LIKE ? OR summary LIKE ? OR COALESCE(entity_id, "") LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like, like);
      }
      if (actionFilter) {
        clauses.push('action = ?');
        params.push(actionFilter);
      }

      const whereSql = clauses.join(' AND ');
      const totalRow = db
        .prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE ${whereSql}`)
        .get(...params) as { c: number };

      const items = db
        .prepare(
          `SELECT * FROM audit_logs WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
        )
        .all(...params, pageSize, offset);

      res.json({
        items,
        total: totalRow.c,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(totalRow.c / pageSize)),
      });
    }
  );

  app.get(
    '/api/backups',
    requireAuth,
    requireRoles('admin'),
    (_req: AuthedRequest, res: Response) => {
      res.json(listDatabaseBackups());
    }
  );

  app.post(
    '/api/backups',
    requireAuth,
    requireRoles('admin'),
    (req: AuthedRequest, res: Response) => {
      try {
        const info = createDatabaseBackup(req.user!);
        res.status(201).json(info);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Zaxira nusxasini yaratishda xatolik.' });
      }
    }
  );

  app.get(
    '/api/backups/:filename/download',
    requireAuth,
    requireRoles('admin'),
    (req: AuthedRequest, res: Response) => {
      try {
        const fullPath = getBackupFilePath(String(req.params.filename));
        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${path.basename(fullPath)}"`
        );
        res.send(fs.readFileSync(fullPath));
      } catch (err: any) {
        res.status(404).json({ error: err.message || 'Zaxira fayli topilmadi.' });
      }
    }
  );

  app.post(
    '/api/backups/:filename/restore',
    requireAuth,
    requireRoles('admin'),
    (req: AuthedRequest, res: Response) => {
      try {
        restoreDatabaseBackup(String(req.params.filename), req.user!);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Zaxiradan tiklashda xatolik.' });
      }
    }
  );

  app.get(
    '/api/system-tests',
    requireAuth,
    requireRoles('admin'),
    (_req: AuthedRequest, res: Response) => {
      const items = db.prepare('SELECT * FROM system_tests ORDER BY id DESC LIMIT 10').all();
      res.json(items);
    }
  );

  app.post(
    '/api/system-tests/run',
    requireAuth,
    requireRoles('admin'),
    (req: AuthedRequest, res: Response) => {
      try {
        const result = runSystemVerificationSuite(req.user!);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Sinovlarni bajarishda xatolik.' });
      }
    }
  );

  // ============================================================================
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC ASSETS
  // ============================================================================
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve('dist'));
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT ?? 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`E-Kadastr Nazorat server running on http://0.0.0.0:${PORT}`);
  });
}

createServer();
