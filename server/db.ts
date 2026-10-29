import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './security.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUP_DIR = path.resolve(DATA_DIR, 'backups');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const DB_PATH = path.resolve(DATA_DIR, 'ekadastr.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('viloyat', 'tuman', 'mahalla')),
      parent_id INTEGER REFERENCES regions(id),
      code TEXT NOT NULL UNIQUE,
      center_lat REAL NOT NULL,
      center_lng REAL NOT NULL,
      default_zoom INTEGER NOT NULL DEFAULT 14
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'inspector', 'mahalla')),
      phone TEXT,
      position TEXT,
      viloyat_id INTEGER REFERENCES regions(id),
      tuman_id INTEGER REFERENCES regions(id),
      mahalla_id INTEGER REFERENCES regions(id),
      is_blocked INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip_address TEXT,
      succeeded INTEGER NOT NULL DEFAULT 0,
      attempted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system_uid TEXT NOT NULL UNIQUE,
      viloyat_id INTEGER NOT NULL REFERENCES regions(id),
      tuman_id INTEGER NOT NULL REFERENCES regions(id),
      mahalla_id INTEGER NOT NULL REFERENCES regions(id),
      address TEXT NOT NULL,
      address_code TEXT,
      parent_parcel_code TEXT,
      object_type TEXT NOT NULL DEFAULT 'residential_house' CHECK(object_type IN ('residential_house', 'land_parcel', 'auxiliary_building')),
      latitude REAL,
      longitude REAL,
      location_verified INTEGER NOT NULL DEFAULT 1,
      pending_lat REAL,
      pending_lng REAL,
      pending_location_note TEXT,
      pending_location_by INTEGER REFERENCES users(id),
      cadastral_number TEXT,
      cadastral_status TEXT NOT NULL DEFAULT 'unverified' CHECK(cadastral_status IN ('confirmed', 'confirmed_absent', 'unverified')),
      inspection_status TEXT NOT NULL DEFAULT 'new' CHECK(inspection_status IN ('new', 'sent_for_inspection', 'assigned', 'in_progress', 'needs_info', 'completed', 'reopened')),
      source TEXT NOT NULL DEFAULT 'Qo‘lda kiritilgan',
      source_date TEXT,
      assigned_user_id INTEGER REFERENCES users(id),
      last_inspected_at TEXT,
      notes TEXT,
      owner_reference TEXT,
      built_year INTEGER,
      floors_count INTEGER,
      rooms_count INTEGER,
      land_area_m2 REAL,
      building_area_m2 REAL,
      wall_material TEXT,
      utilities_info TEXT,
      registration_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_properties_coords ON properties(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_properties_region ON properties(viloyat_id, tuman_id, mahalla_id);
    CREATE INDEX IF NOT EXISTS idx_properties_cadastre ON properties(cadastral_number);
    CREATE INDEX IF NOT EXISTS idx_properties_statuses ON properties(cadastral_status, inspection_status);

    CREATE TABLE IF NOT EXISTS cadastral_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      cadastral_number TEXT NOT NULL,
      land_area_sqm REAL,
      building_area_sqm REAL,
      source_authority TEXT NOT NULL,
      verification_doc_ref TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      assigned_to INTEGER REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent_for_inspection' CHECK(status IN ('new', 'sent_for_inspection', 'assigned', 'in_progress', 'needs_info', 'completed', 'reopened')),
      due_date TEXT,
      result_summary TEXT,
      reopen_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_property ON tasks(property_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to, status);

    CREATE TABLE IF NOT EXISTS inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      inspector_id INTEGER NOT NULL REFERENCES users(id),
      cadastral_number_checked TEXT,
      authority_source TEXT NOT NULL,
      proposed_cadastral_status TEXT NOT NULL CHECK(proposed_cadastral_status IN ('confirmed', 'confirmed_absent', 'unverified')),
      inspection_outcome TEXT NOT NULL CHECK(inspection_outcome IN ('in_progress', 'needs_info', 'completed', 'reopened')),
      comment TEXT NOT NULL,
      inspected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      total_rows INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      flagged_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      doc_title TEXT NOT NULL,
      doc_number TEXT,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      data_url TEXT,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      property_id INTEGER,
      summary TEXT NOT NULL,
      changes_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_property ON audit_logs(property_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suite_name TEXT NOT NULL,
      passed INTEGER NOT NULL,
      total_checks INTEGER NOT NULL,
      passed_checks INTEGER NOT NULL,
      details_json TEXT NOT NULL,
      executed_by_name TEXT NOT NULL,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const existingUsers = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (existingUsers.c === 0) {
    seedInitialAndijonData();
  }
  ensureYuqoriMahallaSetup();
  ensurePropertyTechnicalColumns();
}

function ensurePropertyTechnicalColumns(): void {
  const cols = db.prepare('PRAGMA table_info(properties)').all() as { name: string }[];
  const existingNames = new Set(cols.map((c) => c.name));

  const requiredCols: [string, string][] = [
    ['built_year', 'INTEGER'],
    ['floors_count', 'INTEGER'],
    ['rooms_count', 'INTEGER'],
    ['land_area_m2', 'REAL'],
    ['building_area_m2', 'REAL'],
    ['wall_material', 'TEXT'],
    ['utilities_info', 'TEXT'],
    ['registration_date', 'TEXT'],
  ];

  for (const [colName, colType] of requiredCols) {
    if (!existingNames.has(colName)) {
      db.exec(`ALTER TABLE properties ADD COLUMN ${colName} ${colType}`);
    }
  }

  // Backfill realistic technical passport data on seeded records where built_year is not yet populated
  const rowsToBackfill = db
    .prepare(
      'SELECT id, object_type, cadastral_status, source_date FROM properties WHERE built_year IS NULL AND object_type != ?'
    )
    .all('land_parcel') as {
    id: number;
    object_type: string;
    cadastral_status: string;
    source_date: string | null;
  }[];

  if (rowsToBackfill.length > 0) {
    const wallMaterials = [
      'Pishiq g‘isht',
      'Pishiq g‘isht',
      'Shlakoblok (suvoqli)',
      'Xom g‘isht (suvoqli)',
      'Temir-beton va g‘isht',
      'Gazoblok',
    ];
    const utilitiesVariants = [
      'Elektr energiyasi, tabiiy gaz, ichimlik suvi',
      'Elektr energiyasi, tabiiy gaz, ichimlik suvi, oqova tarmog‘i',
      'Elektr energiyasi, ichimlik suvi, suyultirilgan gaz',
      'Elektr energiyasi, tabiiy gaz, markaziy ichimlik suvi',
    ];
    const builtYears = [
      1988, 1994, 1999, 2003, 2006, 2009, 2012, 2014, 2016, 2018, 2020, 2021, 2023,
    ];

    const upd = db.prepare(`
      UPDATE properties
      SET built_year = ?,
          floors_count = ?,
          rooms_count = ?,
          land_area_m2 = ?,
          building_area_m2 = ?,
          wall_material = ?,
          utilities_info = ?,
          registration_date = ?
      WHERE id = ?
    `);

    const tx = db.transaction(() => {
      for (const r of rowsToBackfill) {
        const seed = r.id * 7 + 3;
        const year = builtYears[seed % builtYears.length];
        const isAux = r.object_type === 'auxiliary_building';
        const floors = isAux ? 1 : seed % 4 === 0 ? 2 : 1;
        const rooms = isAux ? 2 : floors === 2 ? 6 + (seed % 3) : 3 + (seed % 4);
        const landArea = 400 + (seed % 5) * 100; // 4.00 - 8.00 sotix
        const buildArea = isAux
          ? 48 + (seed % 3) * 14
          : floors === 2
          ? 185 + (seed % 5) * 18
          : 105 + (seed % 6) * 16;
        const wall = wallMaterials[seed % wallMaterials.length];
        const utils = utilitiesVariants[seed % utilitiesVariants.length];
        const regYear = Math.min(2025, year + 1 + (seed % 3));
        const regMonth = String((seed % 11) + 1).padStart(2, '0');
        const regDay = String(((seed * 3) % 27) + 1).padStart(2, '0');
        const regDate =
          r.cadastral_status === 'confirmed' ? `${regYear}-${regMonth}-${regDay}` : null;

        upd.run(year, floors, rooms, landArea, buildArea, wall, utils, regDate, r.id);
      }

      // Also populate land_area_m2 for pure land_parcel records if null
      db.prepare(
        "UPDATE properties SET land_area_m2 = 600, utilities_info = 'Elektr tarmog‘i va suvoqova yaqinida' WHERE object_type = 'land_parcel' AND land_area_m2 IS NULL"
      ).run();
    });

    tx();
  }
}

function ensureYuqoriMahallaSetup(): void {
  const tx = db.transaction(() => {
    const vilRow = db
      .prepare("SELECT id FROM regions WHERE level = 'viloyat' ORDER BY id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    const tumRow = db
      .prepare("SELECT id FROM regions WHERE level = 'tuman' AND name = 'Andijon shahri' LIMIT 1")
      .get() as { id: number } | undefined;

    if (!vilRow || !tumRow) return;

    let yuqoriRegion = db
      .prepare("SELECT id FROM regions WHERE level = 'mahalla' AND (code = 'AND-YUQ' OR name LIKE 'Yuqori%') LIMIT 1")
      .get() as { id: number } | undefined;

    if (!yuqoriRegion) {
      const insReg = db
        .prepare(
          `INSERT INTO regions (name, level, parent_id, code, center_lat, center_lng, default_zoom)
           VALUES (?, 'mahalla', ?, 'AND-YUQ', 40.7872, 72.3614, 17)`
        )
        .run('Yuqori MFY', tumRow.id);
      yuqoriRegion = { id: Number(insReg.lastInsertRowid) };
    }

    const existingYuqoriUser = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get('0212010') as { id: number } | undefined;

    let yuqoriUserId: number;
    if (!existingYuqoriUser) {
      const insUser = db
        .prepare(
          `INSERT INTO users (username, password_hash, full_name, role, phone, position, viloyat_id, tuman_id, mahalla_id, is_blocked)
           VALUES (?, ?, ?, 'mahalla', ?, ?, ?, ?, ?, 0)`
        )
        .run(
          '0212010',
          hashPassword('0212010'),
          'Yuqori MFY mas’ul vakili',
          '+998 94 212-01-00',
          'Yuqori mahalla fuqarolar yig‘ini vakili',
          vilRow.id,
          tumRow.id,
          yuqoriRegion.id
        );
      yuqoriUserId = Number(insUser.lastInsertRowid);
    } else {
      yuqoriUserId = existingYuqoriUser.id;
      db.prepare(
        `UPDATE users
         SET password_hash = ?, role = 'mahalla', viloyat_id = ?, tuman_id = ?, mahalla_id = ?, is_blocked = 0
         WHERE id = ?`
      ).run(hashPassword('0212010'), vilRow.id, tumRow.id, yuqoriRegion.id, yuqoriUserId);
    }

    const propCount = db
      .prepare('SELECT COUNT(*) as c FROM properties WHERE mahalla_id = ?')
      .get(yuqoriRegion.id) as { c: number };

    if (propCount.c === 0) {
      const inspRow = db
        .prepare("SELECT id FROM users WHERE role = 'inspector' AND tuman_id = ? LIMIT 1")
        .get(tumRow.id) as { id: number } | undefined;
      const inspId = inspRow?.id ?? null;

      const insProp = db.prepare(`
        INSERT INTO properties (
          system_uid, viloyat_id, tuman_id, mahalla_id, address, address_code, parent_parcel_code,
          object_type, latitude, longitude, location_verified, cadastral_number,
          cadastral_status, inspection_status, source, source_date, assigned_user_id, last_inspected_at, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'residential_house', ?, ?, ?, ?, ?, ?, ?, '2026-10-28', ?, ?, ?)
      `);

      const p1 = Number(
        insProp.run(
          'AND-YUQ-0001',
          vilRow.id,
          tumRow.id,
          yuqoriRegion.id,
          'Yuqori mahalla ko‘chasi, 4-uy',
          'UZ-1703-401-504',
          'PARCEL-YUQ-04',
          40.78745,
          72.36095,
          1,
          '17:03:401:05:01:0004',
          'confirmed',
          'completed',
          'Davlat kadastrlar palatasi reyestri',
          inspId,
          '2026-10-25 10:20:00',
          'Davlat reyestrida mulk huquqi va kadastr raqami tasdiqlangan.'
        ).lastInsertRowid
      );

      const p2 = Number(
        insProp.run(
          'AND-YUQ-0002',
          vilRow.id,
          tumRow.id,
          yuqoriRegion.id,
          'Yuqori mahalla ko‘chasi, 9-uy',
          'UZ-1703-401-509',
          'PARCEL-YUQ-09',
          40.78712,
          72.36168,
          1,
          '17:03:401:05:01:0009',
          'confirmed',
          'completed',
          'Davlat kadastrlar palatasi reyestri',
          inspId,
          '2026-10-25 11:05:00',
          'Yakka tartibdagi turar-joy sifatida ro‘yxatdan o‘tgan.'
        ).lastInsertRowid
      );

      const p3 = Number(
        insProp.run(
          'AND-YUQ-0003',
          vilRow.id,
          tumRow.id,
          yuqoriRegion.id,
          'Bog‘ishamol tor ko‘chasi, 12-uy',
          'UZ-1703-401-512',
          'PARCEL-YUQ-12',
          40.78685,
          72.3621,
          1,
          null,
          'unverified',
          'in_progress',
          'Yuqori MFY xatlov ro‘yxati',
          inspId,
          null,
          'Excel faylida kadastr raqami topilmadi — vakolatli bazadan tekshirilmoqda.'
        ).lastInsertRowid
      );

      const p4 = Number(
        insProp.run(
          'AND-YUQ-0004',
          vilRow.id,
          tumRow.id,
          yuqoriRegion.id,
          'Bog‘ishamol tor ko‘chasi, 17-uy',
          null,
          'PARCEL-YUQ-17',
          40.78762,
          72.36245,
          1,
          null,
          'unverified',
          'needs_info',
          'Yuqori MFY vakili xabarnomasi',
          inspId,
          '2026-10-27 15:40:00',
          'Bitta hovlida ikkita uy-joy joylashgan — uy raqami va egalik qarori nusxasini aniqlashtirish zarur.'
        ).lastInsertRowid
      );

      insProp.run(
        'AND-YUQ-0005',
        vilRow.id,
        tumRow.id,
        yuqoriRegion.id,
        'Ziyolilar ko‘chasi, 23-uy',
        'UZ-1703-401-523',
        'PARCEL-YUQ-23',
        40.7865,
        72.3606,
        1,
        null,
        'confirmed_absent',
        'completed',
        'Joylashuv tekshiruvi dalolatnomasi #DN-508',
        inspId,
        '2026-10-26 16:15:00',
        'Kadastr xodimi tomonidan joyida tekshirildi — kadastr hujjati rasmiylashtirilmagani tasdiqlandi.'
      );

      const p6 = Number(
        insProp.run(
          'AND-YUQ-0006',
          vilRow.id,
          tumRow.id,
          yuqoriRegion.id,
          'Ziyolilar ko‘chasi, 31-uy',
          null,
          null,
          null,
          null,
          0,
          null,
          'unverified',
          'sent_for_inspection',
          'Yuqori MFY xatlov ro‘yxati',
          inspId,
          null,
          'Xaritadagi koordinatasi hali belgilanmagan — Yuqori MFY vakili tomonidan sun’iy yo‘ldosh xaritasida belgilanishi lozim.'
        ).lastInsertRowid
      );

      db.prepare(
        `INSERT INTO cadastral_records (property_id, cadastral_number, source_authority, verification_doc_ref)
         VALUES (?, ?, 'Davlat kadastrlar palatasi reyestri', ?)`
      ).run(p1, '17:03:401:05:01:0004', 'REG-YUQ-01');
      db.prepare(
        `INSERT INTO cadastral_records (property_id, cadastral_number, source_authority, verification_doc_ref)
         VALUES (?, ?, 'Davlat kadastrlar palatasi reyestri', ?)`
      ).run(p2, '17:03:401:05:01:0009', 'REG-YUQ-02');

      db.prepare(
        `INSERT INTO tasks (property_id, assigned_to, created_by, reason, status, due_date)
         VALUES (?, ?, ?, ?, 'in_progress', date('now', '+4 days'))`
      ).run(
        p3,
        inspId,
        yuqoriUserId,
        'Kadastr raqami mavjud emasligi sababli vakolatli kadastr bazasidan tekshirish'
      );

      db.prepare(
        `INSERT INTO tasks (property_id, assigned_to, created_by, reason, status, due_date, result_summary)
         VALUES (?, ?, ?, ?, 'needs_info', date('now', '+2 days'), ?)`
      ).run(
        p4,
        inspId,
        yuqoriUserId,
        'Bitta yer uchastkasidagi ikkinchi uy-joy kadastr holatini aniqlash',
        'Mahalla vakilidan uy raqami va qaror rekvizitlarini aniqlashtirib yuborish so‘raldi.'
      );

      db.prepare(
        `INSERT INTO tasks (property_id, assigned_to, created_by, reason, status, due_date)
         VALUES (?, ?, ?, ?, 'sent_for_inspection', date('now', '+5 days'))`
      ).run(
        p6,
        inspId,
        yuqoriUserId,
        'Joylashuv koordinatasini aniqlash va kadastr holatini tekshirish'
      );

      createNotification({
        user_id: yuqoriUserId,
        title: 'Xaritada belgilash talab etiladi',
        message: 'AND-YUQ-0006 (Ziyolilar ko‘chasi, 31-uy) obyektining sun’iy yo‘ldosh xaritasidagi joylashuvini belgilang.',
        entity_type: 'property',
        entity_id: p6,
      });

      createNotification({
        user_id: yuqoriUserId,
        title: 'Qo‘shimcha ma’lumot so‘raldi',
        message: 'AND-YUQ-0004 (Bog‘ishamol tor ko‘chasi, 17-uy) bo‘yicha kadastr xodimi qo‘shimcha izoh so‘radi.',
        entity_type: 'property',
        entity_id: p4,
      });
    }
  });

  tx();
}

export function writeAuditLog(params: {
  actor_id: number | null;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id?: string | number | null;
  property_id?: number | null;
  summary: string;
  changes?: unknown;
  ip_address?: string;
}): void {
  db.prepare(`
    INSERT INTO audit_logs (
      actor_id, actor_name, actor_role, action, entity_type, entity_id, property_id, summary, changes_json, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    params.actor_id,
    params.actor_name,
    params.actor_role,
    params.action,
    params.entity_type,
    params.entity_id != null ? String(params.entity_id) : null,
    params.property_id ?? null,
    params.summary,
    params.changes ? JSON.stringify(params.changes) : null,
    params.ip_address ?? '127.0.0.1'
  );
}

export function createNotification(params: {
  user_id: number;
  title: string;
  message: string;
  entity_type?: string;
  entity_id?: number;
}): void {
  db.prepare(`
    INSERT INTO notifications (user_id, title, message, entity_type, entity_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
  `).run(
    params.user_id,
    params.title,
    params.message,
    params.entity_type ?? null,
    params.entity_id ?? null
  );
}

function seedInitialAndijonData(): void {
  const tx = db.transaction(() => {
    // 1. Regions: Andijon viloyati -> 4 Tuman/Shahar -> 11 Mahalla
    const insertRegion = db.prepare(`
      INSERT INTO regions (name, level, parent_id, code, center_lat, center_lng, default_zoom)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const vilAndijon = Number(
      insertRegion.run('Andijon viloyati', 'viloyat', null, '1703', 40.7685, 72.3398, 11).lastInsertRowid
    );

    const tumAndijonSh = Number(
      insertRegion.run('Andijon shahri', 'tuman', vilAndijon, '1703401', 40.7829, 72.3442, 14).lastInsertRowid
    );
    const tumAsaka = Number(
      insertRegion.run('Asaka tumani', 'tuman', vilAndijon, '1703224', 40.6415, 72.2396, 14).lastInsertRowid
    );
    const tumXonobod = Number(
      insertRegion.run('Xonobod shahri', 'tuman', vilAndijon, '1703408', 40.8058, 72.9719, 14).lastInsertRowid
    );
    const tumShahrixon = Number(
      insertRegion.run('Shahrixon tumani', 'tuman', vilAndijon, '1703230', 40.7133, 72.0575, 14).lastInsertRowid
    );

    // Andijon shahri mahallalari
    const mahBoburshoh = Number(
      insertRegion.run('Boburshoh MFY', 'mahalla', tumAndijonSh, 'AND-BOB', 40.7834, 72.3455, 17).lastInsertRowid
    );
    const mahMustaqillik = Number(
      insertRegion.run('Mustaqillik MFY', 'mahalla', tumAndijonSh, 'AND-MUS', 40.7902, 72.3381, 17).lastInsertRowid
    );
    const mahNavroz = Number(
      insertRegion.run('Navro‘z MFY', 'mahalla', tumAndijonSh, 'AND-NAV', 40.7755, 72.3522, 17).lastInsertRowid
    );
    const mahYangihayot = Number(
      insertRegion.run('Yangi hayot MFY', 'mahalla', tumAndijonSh, 'AND-YAN', 40.7694, 72.3369, 17).lastInsertRowid
    );

    // Asaka tumani mahallalari
    const mahChontak = Number(
      insertRegion.run('Cho‘ntak MFY', 'mahalla', tumAsaka, 'ASA-CHO', 40.6442, 72.2412, 17).lastInsertRowid
    );
    const mahQadim = Number(
      insertRegion.run('Qadim MFY', 'mahalla', tumAsaka, 'ASA-QAD', 40.6388, 72.2351, 17).lastInsertRowid
    );
    const mahNavbahor = Number(
      insertRegion.run('Navbahor MFY', 'mahalla', tumAsaka, 'ASA-NVB', 40.6468, 72.2485, 17).lastInsertRowid
    );

    // Xonobod shahri mahallalari
    const mahAnhor = Number(
      insertRegion.run('Anhor MFY', 'mahalla', tumXonobod, 'XON-ANH', 40.8065, 72.9735, 17).lastInsertRowid
    );
    const mahTinchlik = Number(
      insertRegion.run('Tinchlik MFY', 'mahalla', tumXonobod, 'XON-TIN', 40.8021, 72.9668, 17).lastInsertRowid
    );

    // Shahrixon tumani mahallalari
    const mahDostlik = Number(
      insertRegion.run('Do‘stlik MFY', 'mahalla', tumShahrixon, 'SHA-DOS', 40.7145, 72.0588, 17).lastInsertRowid
    );
    const mahGuliston = Number(
      insertRegion.run('Guliston MFY', 'mahalla', tumShahrixon, 'SHA-GUL', 40.7098, 72.0524, 17).lastInsertRowid
    );

    // 2. Users (3 Roles: Administrator, Kadastr xodimi, Mahalla vakili)
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, phone, position, viloyat_id, tuman_id, mahalla_id, is_blocked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    const userAdmin = Number(
      insertUser.run(
        'admin',
        hashPassword('Admin@2026!'),
        'Rustamov Sardorbek Alisherovich',
        'admin',
        '+998 74 223-45-10',
        'Viloyat kadastr nazorati bosh administratori',
        vilAndijon,
        null,
        null
      ).lastInsertRowid
    );

    const userInspAndijon = Number(
      insertUser.run(
        'kadastr_andijon',
        hashPassword('Kadastr@2026!'),
        'Qodirov Jahongir Baxtiyorovich',
        'inspector',
        '+998 90 254-11-22',
        'Andijon shahar yetakchi kadastr muhandisi',
        vilAndijon,
        tumAndijonSh,
        null
      ).lastInsertRowid
    );

    const userInspAsaka = Number(
      insertUser.run(
        'kadastr_asaka',
        hashPassword('Kadastr@2026!'),
        'Yo‘ldoshev Otabek Karimovich',
        'inspector',
        '+998 91 610-33-44',
        'Asaka tumani kadastr inspektori',
        vilAndijon,
        tumAsaka,
        null
      ).lastInsertRowid
    );

    const userInspHudud = Number(
      insertUser.run(
        'kadastr_sharq',
        hashPassword('Kadastr@2026!'),
        'Abdurahmonov Sherzod Rustamovich',
        'inspector',
        '+998 93 418-77-88',
        'Xonobod shahar kadastr inspektori',
        vilAndijon,
        tumXonobod,
        null
      ).lastInsertRowid
    );

    const userMahBoburshoh = Number(
      insertUser.run(
        'mahalla_boburshoh',
        hashPassword('Mahalla@2026!'),
        'Karimova Dilnoza Anvarovna',
        'mahalla',
        '+998 94 562-90-15',
        'Boburshoh MFY hokim yordamchisi / vakili',
        vilAndijon,
        tumAndijonSh,
        mahBoburshoh
      ).lastInsertRowid
    );

    const userMahMustaqillik = Number(
      insertUser.run(
        'mahalla_mustaqillik',
        hashPassword('Mahalla@2026!'),
        'Toshmatov Azizbek Hamidovich',
        'mahalla',
        '+998 97 994-12-03',
        'Mustaqillik MFY mas’ul vakili',
        vilAndijon,
        tumAndijonSh,
        mahMustaqillik
      ).lastInsertRowid
    );

    // 3. Seed realistic Residential Properties across Andijon viloyati
    interface SeedProp {
      uid: string;
      tuman: number;
      mahalla: number;
      address: string;
      addressCode: string | null;
      parcelCode: string | null;
      objType: 'residential_house' | 'land_parcel' | 'auxiliary_building';
      lat: number | null;
      lng: number | null;
      locVerified: number;
      cadNum: string | null;
      cadStatus: 'confirmed' | 'confirmed_absent' | 'unverified';
      inspStatus:
        | 'new'
        | 'sent_for_inspection'
        | 'assigned'
        | 'in_progress'
        | 'needs_info'
        | 'completed'
        | 'reopened';
      source: string;
      sourceDate: string;
      assignedTo: number | null;
      lastInspected: string | null;
      notes: string | null;
      taskReason?: string;
      dueDate?: string;
    }

    const seedProps: SeedProp[] = [
      // --- Boburshoh MFY (Andijon shahri) ---
      {
        uid: 'AND-BOB-0001',
        tuman: tumAndijonSh,
        mahalla: mahBoburshoh,
        address: 'Boburshoh shoh ko‘chasi, 14-uy',
        addressCode: 'UZ-1703-401-014',
        parcelCode: 'PARCEL-BOB-14',
        objType: 'residential_house',
        lat: 40.78365,
        lng: 72.34512,
        locVerified: 1,
        cadNum: '17:03:401:01:02:0014',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-18',
        assignedTo: userInspAndijon,
        lastInspected: '2026-10-05 11:20:00',
        notes: 'Davlat reyestri orqali tasdiqlangan asosiy turar-joy binosi.',
      },
      {
        uid: 'AND-BOB-0002',
        tuman: tumAndijonSh,
        mahalla: mahBoburshoh,
        address: 'Boburshoh shoh ko‘chasi, 14A-uy (Qo‘shimcha bino)',
        addressCode: 'UZ-1703-401-014A',
        parcelCode: 'PARCEL-BOB-14',
        objType: 'auxiliary_building',
        lat: 40.78382,
        lng: 72.34538,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'in_progress',
        source: 'Mahalla xatlov xabarnomasi',
        sourceDate: '2026-10-12',
        assignedTo: userInspAndijon,
        lastInspected: null,
        notes: 'Bitta yer uchastkasida yangi qurilgan ikkinchi imorat; kadastr yozuvi aniqlanmoqda.',
        taskReason: 'Bitta uchastkadagi ikkinchi binoning alohida kadastr raqami mavjudligini tekshirish',
        dueDate: '2026-11-05',
      },
      {
        uid: 'AND-BOB-0003',
        tuman: tumAndijonSh,
        mahalla: mahBoburshoh,
        address: 'Boburshoh shoh ko‘chasi, 18-uy',
        addressCode: 'UZ-1703-401-018',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.78415,
        lng: 72.34605,
        locVerified: 1,
        cadNum: '17:03:401:01:02:0018',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-18',
        assignedTo: userInspAndijon,
        lastInspected: '2026-10-06 14:15:00',
        notes: 'Huquqiy hujjat va koordinatalar mos.',
      },
      {
        uid: 'AND-BOB-0004',
        tuman: tumAndijonSh,
        mahalla: mahBoburshoh,
        address: 'Amir Temur ko‘chasi, 7-tor ko‘cha, 9-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.78285,
        lng: 72.3444,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'confirmed_absent',
        inspStatus: 'completed',
        source: 'Joyiga chiqib o‘tkazilgan dalolatnoma #DN-412',
        sourceDate: '2026-10-14',
        assignedTo: userInspAndijon,
        lastInspected: '2026-10-19 16:40:00',
        notes: 'Vakolatli kadastr xodimi tomonidan Yagona tizimdan tekshirildi va kadastr ro‘yxatidan o‘tmaganligi dalolatnoma bilan tasdiqlandi.',
        taskReason: 'Excel importida kadastr raqami ko‘rsatilmagan obyekt tekshiruvi',
        dueDate: '2026-10-20',
      },
      {
        uid: 'AND-BOB-0005',
        tuman: tumAndijonSh,
        mahalla: mahBoburshoh,
        address: 'Amir Temur ko‘chasi, 7-tor ko‘cha, 11-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.78262,
        lng: 72.34488,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'assigned',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspAndijon,
        lastInspected: null,
        notes: 'Excel faylida kadastr raqami bo‘sh kelgan. Qoidaga binoan sariq holatda tekshiruvga yuborildi.',
        taskReason: 'Excel jadvalida kadastr raqami mavjud emas — vakolatli bazadan solishtirish',
        dueDate: '2026-10-25', // Overdue task for realistic reporting!
      },
      {
        uid: 'AND-BOB-0006',
        tuman: tumAndijonSh,
        mahalla: mahBoburshoh,
        address: 'Uvaysiy ko‘chasi, 23-uy',
        addressCode: 'UZ-1703-401-023',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7847,
        lng: 72.3439,
        locVerified: 1,
        cadNum: '17:03:401:01:03:0023',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-18',
        assignedTo: null,
        lastInspected: '2026-09-22 10:00:00',
        notes: 'Reyestr ma’lumoti tasdiqlangan.',
      },
      {
        uid: 'AND-BOB-0007',
        tuman: tumAndijonSh,
        mahalla: mahBoburshoh,
        address: 'Uvaysiy ko‘chasi, 29-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: null,
        lng: null,
        locVerified: 0,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'sent_for_inspection',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspAndijon,
        lastInspected: null,
        notes: 'Koordinatalar Excel faylida kiritilmagan (Kulrang holat). Mahalla vakili bilan joylashuvni aniqlash zarur.',
        taskReason: 'Geografik koordinata mavjud emas va kadastr holati aniqlanmagan',
        dueDate: '2026-11-03',
      },
      {
        uid: 'AND-BOB-0008',
        tuman: tumAndijonSh,
        mahalla: mahBoburshoh,
        address: 'Cho‘lpon shoh ko‘chasi, 41-uy',
        addressCode: 'UZ-1703-401-041',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.78195,
        lng: 72.3469,
        locVerified: 1,
        cadNum: '17:03:401:01:04:0041',
        cadStatus: 'unverified',
        inspStatus: 'needs_info',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspAndijon,
        lastInspected: '2026-10-24 15:10:00',
        notes: 'Manzil va kadastr yozuvidagi uy raqami (41 vs 41B) o‘rtasida tafovut aniqlandi; qo‘shimcha hujjat so‘raldi.',
        taskReason: 'Manzil va reyestr yozuvi mos kelmadi — qo‘shimcha aniqlashtirish',
        dueDate: '2026-11-02',
      },

      // --- Mustaqillik MFY (Andijon shahri) ---
      {
        uid: 'AND-MUS-0009',
        tuman: tumAndijonSh,
        mahalla: mahMustaqillik,
        address: 'Mustaqillik ko‘chasi, 5-uy',
        addressCode: 'UZ-1703-401-105',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.79045,
        lng: 72.33785,
        locVerified: 1,
        cadNum: '17:03:401:02:01:0005',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-18',
        assignedTo: userInspAndijon,
        lastInspected: '2026-09-29 09:45:00',
        notes: 'Tasdiqlangan turar-joy.',
      },
      {
        uid: 'AND-MUS-0010',
        tuman: tumAndijonSh,
        mahalla: mahMustaqillik,
        address: 'Mustaqillik ko‘chasi, 7-uy',
        addressCode: 'UZ-1703-401-107',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.79088,
        lng: 72.33845,
        locVerified: 1,
        cadNum: '17:03:401:02:01:0007',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-18',
        assignedTo: null,
        lastInspected: '2026-09-29 10:15:00',
        notes: 'Tasdiqlangan turar-joy.',
      },
      {
        uid: 'AND-MUS-0011',
        tuman: tumAndijonSh,
        mahalla: mahMustaqillik,
        address: 'Fitrat ko‘chasi, 16-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.78962,
        lng: 72.33915,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'assigned',
        source: 'Mahalla vakili xabarnomasi',
        sourceDate: '2026-10-21',
        assignedTo: userInspAndijon,
        lastInspected: null,
        notes: 'Mahalla vakili xarita orqali belgilab kiritgan uy-joy.',
        taskReason: 'Mahalla vakili tomonidan kadastr holati noma’lum deb xabar berilgan obyekt',
        dueDate: '2026-11-04',
      },
      {
        uid: 'AND-MUS-0012',
        tuman: tumAndijonSh,
        mahalla: mahMustaqillik,
        address: 'Fitrat ko‘chasi, 22-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7892,
        lng: 72.3372,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'confirmed_absent',
        inspStatus: 'completed',
        source: 'Joyiga chiqib o‘tkazilgan dalolatnoma #DN-429',
        sourceDate: '2026-10-18',
        assignedTo: userInspAndijon,
        lastInspected: '2026-10-22 17:05:00',
        notes: 'Tekshiruv yakunlandi: davlat ro‘yxatidan o‘tmaganligi rasman tasdiqlandi.',
        taskReason: 'Ro‘yxatdan o‘tmagan yangi turar-joy binosi yuzasidan tekshiruv',
        dueDate: '2026-10-24',
      },
      {
        uid: 'AND-MUS-0013',
        tuman: tumAndijonSh,
        mahalla: mahMustaqillik,
        address: 'Oltinko‘l ko‘chasi, 3-tor, 4-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'land_parcel',
        lat: null,
        lng: null,
        locVerified: 0,
        cadNum: '17:03:401:02:04:0091',
        cadStatus: 'unverified',
        inspStatus: 'sent_for_inspection',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspAndijon,
        lastInspected: null,
        notes: 'Kadastr raqami bor, biroq koordinata noto‘g‘ri formatda kelgani sababli joylashuvi aniqlanmagan.',
        taskReason: 'Obyekt koordinatasini xaritada aniqlash va kadastr chegarasini tekshirish',
        dueDate: '2026-11-06',
      },

      // --- Navro'z MFY (Andijon shahri) ---
      {
        uid: 'AND-NAV-0014',
        tuman: tumAndijonSh,
        mahalla: mahNavroz,
        address: 'Navro‘z ko‘chasi, 12-uy',
        addressCode: 'UZ-1703-401-212',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7758,
        lng: 72.3518,
        locVerified: 1,
        cadNum: '17:03:401:03:01:0012',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-18',
        assignedTo: null,
        lastInspected: '2026-09-25 12:00:00',
        notes: 'Tasdiqlangan.',
      },
      {
        uid: 'AND-NAV-0015',
        tuman: tumAndijonSh,
        mahalla: mahNavroz,
        address: 'Navro‘z ko‘chasi, 15-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7751,
        lng: 72.3529,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'in_progress',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspAndijon,
        lastInspected: null,
        notes: 'Arxiv ma’lumotlari ko‘tarilmoqda.',
        taskReason: 'Arxiv orderi mavjudligini va elektron kadastr bazasiga kiritilganini tekshirish',
        dueDate: '2026-11-01',
      },
      {
        uid: 'AND-NAV-0016',
        tuman: tumAndijonSh,
        mahalla: mahNavroz,
        address: 'Mashrab ko‘chasi, 33-uy',
        addressCode: 'UZ-1703-401-233',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7764,
        lng: 72.3534,
        locVerified: 1,
        cadNum: '17:03:401:03:02:0033',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-18',
        assignedTo: null,
        lastInspected: '2026-09-25 14:30:00',
        notes: 'Tasdiqlangan.',
      },

      // --- Yangi hayot MFY (Andijon shahri) ---
      {
        uid: 'AND-YAN-0017',
        tuman: tumAndijonSh,
        mahalla: mahYangihayot,
        address: 'Yangi hayot ko‘chasi, 8-uy',
        addressCode: 'UZ-1703-401-308',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7698,
        lng: 72.3372,
        locVerified: 1,
        cadNum: '17:03:401:04:01:0008',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-18',
        assignedTo: null,
        lastInspected: '2026-10-01 10:20:00',
        notes: 'Tasdiqlangan.',
      },
      {
        uid: 'AND-YAN-0018',
        tuman: tumAndijonSh,
        mahalla: mahYangihayot,
        address: 'Yangi hayot ko‘chasi, 19-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7689,
        lng: 72.3361,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'reopened',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspAndijon,
        lastInspected: '2026-10-23 11:00:00',
        notes: 'Mulkdor tomonidan 1998-yilgi eski order taqdim etilgani sababli qayta tekshiruvga yuborildi.',
        taskReason: 'Qayta tekshiruv: eski texnik pasportni davlat reyestriga solishtirish',
        dueDate: '2026-10-27', // Overdue
      },

      // --- Asaka tumani (Cho'ntak, Qadim, Navbahor MFY) ---
      {
        uid: 'ASA-CHO-0019',
        tuman: tumAsaka,
        mahalla: mahChontak,
        address: 'Imom Buxoriy ko‘chasi, 44-uy',
        addressCode: 'UZ-1703-224-044',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.6445,
        lng: 72.2416,
        locVerified: 1,
        cadNum: '17:03:224:01:01:0044',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-19',
        assignedTo: userInspAsaka,
        lastInspected: '2026-10-08 09:30:00',
        notes: 'Tasdiqlangan.',
      },
      {
        uid: 'ASA-CHO-0020',
        tuman: tumAsaka,
        mahalla: mahChontak,
        address: 'Imom Buxoriy ko‘chasi, 46-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.6439,
        lng: 72.2408,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'assigned',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspAsaka,
        lastInspected: null,
        notes: 'Kadastr raqami ko‘rsatilmagan, inspektorga biriktirildi.',
        taskReason: 'Asaka tumani Cho‘ntak MFY bo‘yicha kadastr raqamini aniqlash',
        dueDate: '2026-11-05',
      },
      {
        uid: 'ASA-CHO-0021',
        tuman: tumAsaka,
        mahalla: mahChontak,
        address: 'Farg‘ona yo‘li ko‘chasi, 12-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.6449,
        lng: 72.2423,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'confirmed_absent',
        inspStatus: 'completed',
        source: 'Asaka kadastr bo‘limi dalolatnomasi #AS-88',
        sourceDate: '2026-10-16',
        assignedTo: userInspAsaka,
        lastInspected: '2026-10-17 15:45:00',
        notes: 'Kadastr hujjati rasmiylashtirilmaganligi joyida tasdiqlandi.',
        taskReason: 'Kadastr holati noma’lum turar-joy tekshiruvi',
        dueDate: '2026-10-19',
      },
      {
        uid: 'ASA-QAD-0022',
        tuman: tumAsaka,
        mahalla: mahQadim,
        address: 'Qadim ko‘chasi, 3-uy',
        addressCode: 'UZ-1703-224-103',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.6391,
        lng: 72.2355,
        locVerified: 1,
        cadNum: '17:03:224:02:01:0003',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-19',
        assignedTo: null,
        lastInspected: '2026-10-02 11:00:00',
        notes: 'Tasdiqlangan.',
      },
      {
        uid: 'ASA-QAD-0023',
        tuman: tumAsaka,
        mahalla: mahQadim,
        address: 'Qadim ko‘chasi, 9-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.6384,
        lng: 72.2346,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'in_progress',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspAsaka,
        lastInspected: null,
        notes: 'Dala o‘lchov ma’lumotlari tekshirilmoqda.',
        taskReason: 'Meros bo‘yicha ajratilgan uy qismining kadastr hisobini tekshirish',
        dueDate: '2026-10-26', // Overdue
      },
      {
        uid: 'ASA-NVB-0024',
        tuman: tumAsaka,
        mahalla: mahNavbahor,
        address: 'Navbahor ko‘chasi, 27-uy',
        addressCode: 'UZ-1703-224-227',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.6471,
        lng: 72.2489,
        locVerified: 1,
        cadNum: '17:03:224:03:01:0027',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-19',
        assignedTo: null,
        lastInspected: '2026-10-03 16:00:00',
        notes: 'Tasdiqlangan.',
      },
      {
        uid: 'ASA-NVB-0025',
        tuman: tumAsaka,
        mahalla: mahNavbahor,
        address: 'Navbahor ko‘chasi, 31-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: null,
        lng: null,
        locVerified: 0,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'sent_for_inspection',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspAsaka,
        lastInspected: null,
        notes: 'Koordinatasi kiritilmagan yozuv — yo‘qolib ketmasligi uchun kulrang holatda saqlangan.',
        taskReason: 'Xaritada uy joylashuvini aniqlash va kadastr yozuvini tekshirish',
        dueDate: '2026-11-08',
      },

      // --- Xonobod shahri (Anhor, Tinchlik MFY) ---
      {
        uid: 'XON-ANH-0026',
        tuman: tumXonobod,
        mahalla: mahAnhor,
        address: 'Anhor bo‘yi ko‘chasi, 10-uy',
        addressCode: 'UZ-1703-408-010',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.8068,
        lng: 72.9739,
        locVerified: 1,
        cadNum: '17:03:408:01:01:0010',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-20',
        assignedTo: userInspHudud,
        lastInspected: '2026-10-10 10:30:00',
        notes: 'Tasdiqlangan.',
      },
      {
        uid: 'XON-ANH-0027',
        tuman: tumXonobod,
        mahalla: mahAnhor,
        address: 'Anhor bo‘yi ko‘chasi, 14-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.8062,
        lng: 72.9728,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'assigned',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: userInspHudud,
        lastInspected: null,
        notes: 'Tekshiruvga biriktirilgan.',
        taskReason: 'Kadastr raqami biriktirilmagan turar-joyni vakolatli bazadan tekshirish',
        dueDate: '2026-11-07',
      },
      {
        uid: 'XON-TIN-0028',
        tuman: tumXonobod,
        mahalla: mahTinchlik,
        address: 'Tinchlik ko‘chasi, 6-uy',
        addressCode: 'UZ-1703-408-106',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.8024,
        lng: 72.9672,
        locVerified: 1,
        cadNum: '17:03:408:02:01:0006',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-20',
        assignedTo: null,
        lastInspected: '2026-10-11 13:20:00',
        notes: 'Tasdiqlangan.',
      },

      // --- Shahrixon tumani (Do'stlik, Guliston MFY) ---
      {
        uid: 'SHA-DOS-0029',
        tuman: tumShahrixon,
        mahalla: mahDostlik,
        address: 'Do‘stlik ko‘chasi, 17-uy',
        addressCode: 'UZ-1703-230-017',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7148,
        lng: 72.0592,
        locVerified: 1,
        cadNum: '17:03:230:01:01:0017',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-21',
        assignedTo: null,
        lastInspected: '2026-10-12 09:15:00',
        notes: 'Tasdiqlangan.',
      },
      {
        uid: 'SHA-DOS-0030',
        tuman: tumShahrixon,
        mahalla: mahDostlik,
        address: 'Do‘stlik ko‘chasi, 21-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7141,
        lng: 72.0581,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'unverified',
        inspStatus: 'sent_for_inspection',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: null,
        lastInspected: null,
        notes: 'Mas’ul kadastr xodimiga biriktirilishi kutilmoqda.',
        taskReason: 'Shahrixon tumani bo‘yicha tekshirilishi zarur obyekt',
        dueDate: '2026-11-10',
      },
      {
        uid: 'SHA-GUL-0031',
        tuman: tumShahrixon,
        mahalla: mahGuliston,
        address: 'Guliston ko‘chasi, 8-uy',
        addressCode: 'UZ-1703-230-108',
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7102,
        lng: 72.0529,
        locVerified: 1,
        cadNum: '17:03:230:02:01:0008',
        cadStatus: 'confirmed',
        inspStatus: 'completed',
        source: 'Kadastr agentligi reyestri (Excel 2026-Q3)',
        sourceDate: '2026-09-21',
        assignedTo: null,
        lastInspected: '2026-10-12 14:40:00',
        notes: 'Tasdiqlangan.',
      },
      {
        uid: 'SHA-GUL-0032',
        tuman: tumShahrixon,
        mahalla: mahGuliston,
        address: 'Guliston ko‘chasi, 12-uy',
        addressCode: null,
        parcelCode: null,
        objType: 'residential_house',
        lat: 40.7094,
        lng: 72.0518,
        locVerified: 1,
        cadNum: null,
        cadStatus: 'confirmed_absent',
        inspStatus: 'completed',
        source: 'Shahrixon tuman kadastr bo‘limi tekshiruv akti #SH-19',
        sourceDate: '2026-10-15',
        assignedTo: null,
        lastInspected: '2026-10-18 16:00:00',
        notes: 'Rasmiy tekshiruv natijasida kadastr ro‘yxatidan o‘tmaganligi tasdiqlangan.',
        taskReason: 'Kadastr hisobida yo‘qligi gumon qilingan bino tekshiruvi',
        dueDate: '2026-10-20',
      },
    ];

    // Add dense cluster neighbors in Boburshoh & Mustaqillik so satellite clustering & rooftop inspection shine
    const extraBoburshoh = [
      { n: '20-uy', dLat: 0.00045, dLng: 0.00075, cad: '17:03:401:01:02:0020', st: 'confirmed' as const },
      { n: '22-uy', dLat: 0.00062, dLng: 0.00095, cad: '17:03:401:01:02:0022', st: 'confirmed' as const },
      { n: '24-uy', dLat: 0.00078, dLng: 0.00112, cad: null, st: 'unverified' as const },
      { n: '26-uy', dLat: -0.00035, dLng: 0.00062, cad: '17:03:401:01:02:0026', st: 'confirmed' as const },
      { n: '28-uy', dLat: -0.00055, dLng: 0.00088, cad: null, st: 'unverified' as const },
      { n: '30-uy', dLat: 0.00095, dLng: -0.00045, cad: '17:03:401:01:02:0030', st: 'confirmed' as const },
    ];
    extraBoburshoh.forEach((item, idx) => {
      const seq = 33 + idx;
      seedProps.push({
        uid: `AND-BOB-00${seq}`,
        tuman: tumAndijonSh,
        mahalla: mahBoburshoh,
        address: `Boburshoh shoh ko‘chasi, ${item.n}`,
        addressCode: item.cad ? `UZ-1703-401-0${seq}` : null,
        parcelCode: null,
        objType: 'residential_house',
        lat: Number((40.7834 + item.dLat).toFixed(6)),
        lng: Number((72.3455 + item.dLng).toFixed(6)),
        locVerified: 1,
        cadNum: item.cad,
        cadStatus: item.st,
        inspStatus: item.st === 'confirmed' ? 'completed' : 'sent_for_inspection',
        source: 'Excel ommaviy import (2026-10)',
        sourceDate: '2026-10-20',
        assignedTo: item.st === 'unverified' ? userInspAndijon : null,
        lastInspected: item.st === 'confirmed' ? '2026-10-20 12:00:00' : null,
        notes:
          item.st === 'confirmed'
            ? 'Avtomatik reyestr solishtiruvi orqali tasdiqlangan.'
            : 'Excel bazada kadastr raqami topilmadi — vakolatli tekshiruv talab etiladi.',
        taskReason:
          item.st === 'unverified'
            ? 'Kadastr holati aniqlanmagan uy-joyni joyida va bazada tekshirish'
            : undefined,
        dueDate: item.st === 'unverified' ? '2026-11-09' : undefined,
      });
    });

    const insertProp = db.prepare(`
      INSERT INTO properties (
        system_uid, viloyat_id, tuman_id, mahalla_id, address, address_code, parent_parcel_code,
        object_type, latitude, longitude, location_verified, cadastral_number, cadastral_status,
        inspection_status, source, source_date, assigned_user_id, last_inspected_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertCadRec = db.prepare(`
      INSERT INTO cadastral_records (
        property_id, cadastral_number, land_area_sqm, building_area_sqm, source_authority, verification_doc_ref, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTask = db.prepare(`
      INSERT INTO tasks (
        property_id, assigned_to, created_by, reason, status, due_date, result_summary, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-5 days'), datetime('now', '-1 days'), ?)
    `);

    const insertInsp = db.prepare(`
      INSERT INTO inspections (
        property_id, task_id, inspector_id, cadastral_number_checked, authority_source, proposed_cadastral_status, inspection_outcome, comment, inspected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAttachment = db.prepare(`
      INSERT INTO attachments (
        property_id, task_id, doc_title, doc_number, file_name, mime_type, file_size, data_url, uploaded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, null, ?, datetime('now', '-3 days'))
    `);

    for (const sp of seedProps) {
      const propId = Number(
        insertProp.run(
          sp.uid,
          vilAndijon,
          sp.tuman,
          sp.mahalla,
          sp.address,
          sp.addressCode,
          sp.parcelCode,
          sp.objType,
          sp.lat,
          sp.lng,
          sp.locVerified,
          sp.cadNum,
          sp.cadStatus,
          sp.inspStatus,
          sp.source,
          sp.sourceDate,
          sp.assignedTo,
          sp.lastInspected,
          sp.notes
        ).lastInsertRowid
      );

      if (sp.cadNum && sp.cadStatus === 'confirmed') {
        insertCadRec.run(
          propId,
          sp.cadNum,
          450,
          185,
          'Kadastr agentligi Yagona integratsiyalashgan axborot tizimi',
          `REG-${sp.uid}`,
          sp.lastInspected ?? '2026-10-01 10:00:00'
        );
      }

      if (sp.taskReason) {
        const completedAt = sp.inspStatus === 'completed' ? sp.lastInspected : null;
        const resultSummary =
          sp.inspStatus === 'completed' && sp.cadStatus === 'confirmed_absent'
            ? 'Vakolatli baza va joyida o‘rganish orqali kadastr hujjati mavjud emasligi tasdiqlandi.'
            : sp.inspStatus === 'needs_info'
            ? 'Uy raqami bo‘yicha qo‘shimcha kadastr yig‘majildi so‘raldi.'
            : null;

        const taskId = Number(
          insertTask.run(
            propId,
            sp.assignedTo,
            userAdmin,
            sp.taskReason,
            sp.inspStatus,
            sp.dueDate ?? '2026-11-05',
            resultSummary,
            completedAt
          ).lastInsertRowid
        );

        if (sp.inspStatus === 'completed' || sp.inspStatus === 'needs_info') {
          insertInsp.run(
            propId,
            taskId,
            sp.assignedTo ?? userInspAndijon,
            sp.cadNum,
            'Kadastr agentligi hududiy boshqarmasi reyestri',
            sp.cadStatus,
            sp.inspStatus === 'completed' ? 'completed' : 'needs_info',
            sp.notes ?? 'Tekshiruv bajarildi.',
            sp.lastInspected ?? '2026-10-20 15:00:00'
          );

          if (sp.cadStatus === 'confirmed_absent') {
            insertAttachment.run(
              propId,
              taskId,
              'Joyida o‘rganish dalolatnomasi',
              `DN-${propId}04`,
              `dalolatnoma_${sp.uid.toLowerCase()}.pdf`,
              'application/pdf',
              148200,
              sp.assignedTo ?? userInspAndijon
            );
          }
        }
      }
    }

    // Add one pending coordinate correction request from Mahalla rep on AND-BOB-0008
    const propBob08 = db.prepare('SELECT id FROM properties WHERE system_uid = ?').get('AND-BOB-0008') as
      | { id: number }
      | undefined;
    if (propBob08) {
      db.prepare(`
        UPDATE properties
        SET pending_lat = 40.78212, pending_lng = 72.34718,
            pending_location_note = 'Xaritadagi belgi qo‘shni 39-uy ustiga tushib qolgan, haqiqiy tom markazi 25 metr sharqda.',
            pending_location_by = ?
        WHERE id = ?
      `).run(userMahBoburshoh, propBob08.id);
    }

    // Seed initial Excel Import batch history
    db.prepare(`
      INSERT INTO imports (
        filename, uploaded_by, total_rows, inserted_count, updated_count, flagged_count, error_count, duplicate_count, errors_json, summary_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-8 days'))
    `).run(
      'andijon_pilot_reyestr_2026_10.xlsx',
      userAdmin,
      41,
      38,
      0,
      14,
      1,
      2,
      JSON.stringify([
        { row: 19, message: 'Majburiy maydon (Manzil) kiritilmagan — yozuv rad etildi.' },
        { row: 27, message: 'AND-BOB-0003 identifikatori fayl ichida takrorlangan (dublikat).' },
        { row: 34, message: '17:03:401:02:01:0005 kadastr raqami fayl ichida takrorlangan (dublikat).' },
      ]),
      JSON.stringify({
        note: 'Andijon viloyati tajriba-sinov hududlari bo‘yicha dastlabki kadastr yozuvlari yuklandi.',
      })
    );

    // Seed Audit Logs
    writeAuditLog({
      actor_id: userAdmin,
      actor_name: 'Rustamov Sardorbek Alisherovich',
      actor_role: 'admin',
      action: 'EXCEL_IMPORT',
      entity_type: 'imports',
      entity_id: 1,
      summary: 'andijon_pilot_reyestr_2026_10.xlsx fayli yuklandi: 38 ta noyob obyekt kiritildi, 2 ta dublikat va 1 ta xato aniqlandi.',
    });

    writeAuditLog({
      actor_id: userInspAndijon,
      actor_name: 'Qodirov Jahongir Baxtiyorovich',
      actor_role: 'inspector',
      action: 'CADASTRE_CONFIRMED_ABSENT',
      entity_type: 'properties',
      entity_id: 'AND-BOB-0004',
      property_id: 4,
      summary: 'AND-BOB-0004 obyekti bo‘yicha tekshiruv yakunlandi: #DN-412 dalolatnoma asosida kadastr yo‘qligi tasdiqlandi.',
      changes: {
        cadastral_status: { from: 'unverified', to: 'confirmed_absent' },
        inspection_status: { from: 'in_progress', to: 'completed' },
      },
    });

    writeAuditLog({
      actor_id: userMahBoburshoh,
      actor_name: 'Karimova Dilnoza Anvarovna',
      actor_role: 'mahalla',
      action: 'LOCATION_CORRECTION_REQUESTED',
      entity_type: 'properties',
      entity_id: 'AND-BOB-0008',
      property_id: propBob08?.id ?? null,
      summary: 'Cho‘lpon shoh ko‘chasi, 41-uy (AND-BOB-0008) bo‘yicha koordinatani tuzatish so‘rovi yuborildi.',
    });

    // Seed Notifications
    createNotification({
      user_id: userAdmin,
      title: 'Joylashuvni tuzatish so‘rovi',
      message: 'Boburshoh MFY vakili AND-BOB-0008 obyekti koordinatasini tuzatish uchun so‘rov yubordi.',
      entity_type: 'property',
      entity_id: propBob08?.id ?? 8,
    });
    createNotification({
      user_id: userInspAndijon,
      title: 'Yangi tekshiruv topshiriqlari',
      message: 'Andijon shahri bo‘yicha 8 ta obyekt tekshiruv natijasini kiritishingizni kutmoqda.',
      entity_type: 'task',
    });
    createNotification({
      user_id: userMahBoburshoh,
      title: 'Koordinatasi aniqlanmagan obyekt',
      message: 'AND-BOB-0007 (Uvaysiy ko‘chasi, 29-uy) obyektining xaritadagi joylashuvini belgilash talab etiladi.',
      entity_type: 'property',
      entity_id: 7,
    });
  });

  tx();
}

export { BACKUP_DIR, DATA_DIR, DB_PATH };
