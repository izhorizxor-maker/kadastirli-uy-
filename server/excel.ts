import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import {
  computeMarkerColor,
  CADASTRAL_STATUS_LABELS,
  INSPECTION_STATUS_LABELS,
  type AuthUser,
  type CadastralStatus,
  type ExcelPreviewResponse,
  type ExcelPreviewRow,
  type RegionItem,
} from '../src/types.ts';
import { db, writeAuditLog } from './db.ts';
import { buildPropertyScopeClause } from './security.ts';

interface CachedPreview {
  createdAt: number;
  uploadedBy: number;
  preview: ExcelPreviewResponse;
}

const previewStore = new Map<string, CachedPreview>();

function sanitizeCellText(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  // Prevent spreadsheet formula injection / execution (TZ Section 8)
  while (str.length > 0 && ['=', '+', '@'].includes(str[0])) {
    str = str.slice(1).trim();
  }
  if (str.startsWith('-') && Number.isNaN(Number(str))) {
    str = str.slice(1).trim();
  }
  return str.slice(0, 500);
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/['’‘`"]/g, '')
    .replace(/[\s_\-()/]+/g, ' ')
    .trim();
}

function resolveColumnValue(row: Record<string, unknown>, aliases: string[]): unknown {
  const entries = Object.entries(row);
  for (const [k, v] of entries) {
    const norm = normalizeHeader(k);
    if (aliases.some((alias) => norm === alias || norm.includes(alias))) {
      return v;
    }
  }
  return undefined;
}

function parseCoordinate(raw: unknown): { value: number | null; invalidFormat: boolean } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { value: null, invalidFormat: false };
  }
  const normalized = String(raw).trim().replace(',', '.');
  const num = Number(normalized);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    return { value: null, invalidFormat: true };
  }
  return { value: Number(num.toFixed(6)), invalidFormat: false };
}

function isValidUzbekistanCoord(lat: number, lng: number): boolean {
  // Uzbekistan geographic bounding box: lat 37.0..45.7, lng 55.9..73.3
  return lat >= 37.0 && lat <= 45.7 && lng >= 55.9 && lng <= 73.3;
}

export function previewExcelBuffer(
  buffer: Buffer,
  filename: string,
  user: AuthUser
): ExcelPreviewResponse {
  // Parse workbook WITHOUT executing formulas or HTML (TZ Section 8)
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: false,
    cellHTML: false,
    cellDates: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Excel faylida ishchi varaq (sheet) topilmadi.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });

  if (rawRows.length === 0) {
    throw new Error('Excel faylida ma’lumot qatorlari topilmadi.');
  }
  if (rawRows.length > 5000) {
    throw new Error('Bir martalik import uchun maksimal 5000 qatorgacha ruxsat etilgan.');
  }

  const columnsDetected = Object.keys(rawRows[0] ?? {});

  const allRegions = db.prepare('SELECT * FROM regions').all() as RegionItem[];
  const viloyatDefault =
    allRegions.find((r) => r.level === 'viloyat') ??
    ({ id: 1, name: 'Andijon viloyati', level: 'viloyat' } as RegionItem);
  const tumanList = allRegions.filter((r) => r.level === 'tuman');
  const mahallaList = allRegions.filter((r) => r.level === 'mahalla');

  const existingProps = db
    .prepare(
      'SELECT id, system_uid, cadastral_number, mahalla_id, address, cadastral_status FROM properties'
    )
    .all() as {
    id: number;
    system_uid: string;
    cadastral_number: string | null;
    mahalla_id: number;
    address: string;
    cadastral_status: CadastralStatus;
  }[];

  const byUid = new Map(existingProps.map((p) => [p.system_uid.toUpperCase(), p]));
  const byCad = new Map(
    existingProps
      .filter((p) => p.cadastral_number)
      .map((p) => [String(p.cadastral_number).toUpperCase(), p])
  );

  const seenUidsInFile = new Set<string>();
  const seenCadsInFile = new Set<string>();

  const rows: ExcelPreviewRow[] = [];
  let validInsertCount = 0;
  let validUpdateCount = 0;
  let conflictReviewCount = 0;
  let duplicateInFileCount = 0;
  let errorCount = 0;
  let missingCoordsCount = 0;
  let missingCadastreCount = 0;

  let autoUidCounter = existingProps.length + 101;

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 2; // 1-based + header row
    const messages: string[] = [];

    let systemUid = sanitizeCellText(
      resolveColumnValue(raw, [
        'obyekt identifikatori',
        'identifikator',
        'system uid',
        'obyekt id',
        'id',
      ])
    ).toUpperCase();

    const cadastralRaw = sanitizeCellText(
      resolveColumnValue(raw, ['kadastr raqami', 'kadastr', 'cadastral number', 'cadastre'])
    );
    const cadastralNumber = cadastralRaw.length > 0 ? cadastralRaw : null;

    const viloyatText =
      sanitizeCellText(resolveColumnValue(raw, ['viloyat', 'region'])) || viloyatDefault.name;
    const tumanText = sanitizeCellText(resolveColumnValue(raw, ['tuman', 'shahar', 'district']));
    const mahallaText = sanitizeCellText(resolveColumnValue(raw, ['mahalla', 'mfy']));
    const addressText = sanitizeCellText(resolveColumnValue(raw, ['manzil', 'kocha', 'address']));

    const latRaw = resolveColumnValue(raw, ['kenglik', 'latitude', 'lat']);
    const lngRaw = resolveColumnValue(raw, ['uzunlik', 'longitude', 'lng', 'lon']);

    const sourceText =
      sanitizeCellText(resolveColumnValue(raw, ['malumot manbasi', 'manba', 'source'])) ||
      `Excel import (${filename})`;
    const sourceDateText =
      sanitizeCellText(resolveColumnValue(raw, ['malumot sanasi', 'sana', 'date'])) ||
      new Date().toISOString().slice(0, 10);

    // Mandatory field validation: Tuman, Mahalla, Manzil
    if (!tumanText || !mahallaText || !addressText) {
      const missing: string[] = [];
      if (!tumanText) missing.push('Tuman');
      if (!mahallaText) missing.push('Mahalla');
      if (!addressText) missing.push('Manzil');
      messages.push(`Majburiy maydonlar to‘ldirilmagan: ${missing.join(', ')}.`);
      errorCount++;
      rows.push({
        rowNumber,
        action: 'error',
        system_uid: systemUid || 'NOMA’LUM',
        cadastral_number: cadastralNumber,
        viloyat: viloyatText,
        tuman: tumanText || '—',
        mahalla: mahallaText || '—',
        address: addressText || '—',
        latitude: null,
        longitude: null,
        location_verified: false,
        source: sourceText,
        source_date: sourceDateText,
        resulting_cadastral_status: 'unverified',
        resulting_marker_color: 'gray',
        messages,
      });
      return;
    }

    // Resolve Tuman & Mahalla against configured regions (or auto-match prefix)
    const matchedTuman = tumanList.find(
      (t) =>
        t.name.toLowerCase() === tumanText.toLowerCase() ||
        t.name.toLowerCase().includes(tumanText.toLowerCase()) ||
        tumanText.toLowerCase().includes(t.name.replace(/ (tumani|shahri)$/i, '').toLowerCase())
    );

    if (!matchedTuman) {
      messages.push(`Tuman topilmadi: "${tumanText}". Avval hududlar bo‘limiga kiriting.`);
      errorCount++;
      rows.push({
        rowNumber,
        action: 'error',
        system_uid: systemUid || 'NOMA’LUM',
        cadastral_number: cadastralNumber,
        viloyat: viloyatText,
        tuman: tumanText,
        mahalla: mahallaText,
        address: addressText,
        latitude: null,
        longitude: null,
        location_verified: false,
        source: sourceText,
        source_date: sourceDateText,
        resulting_cadastral_status: 'unverified',
        resulting_marker_color: 'gray',
        messages,
      });
      return;
    }

    const matchedMahalla = mahallaList.find(
      (m) =>
        m.parent_id === matchedTuman.id &&
        (m.name.toLowerCase() === mahallaText.toLowerCase() ||
          m.name
            .replace(/ mfy$/i, '')
            .toLowerCase()
            .includes(mahallaText.replace(/ mfy$/i, '').toLowerCase()) ||
          mahallaText
            .replace(/ mfy$/i, '')
            .toLowerCase()
            .includes(m.name.replace(/ mfy$/i, '').toLowerCase()))
    );

    if (!matchedMahalla) {
      messages.push(
        `"${matchedTuman.name}" tarkibida "${mahallaText}" mahallasi topilmadi.`
      );
      errorCount++;
      rows.push({
        rowNumber,
        action: 'error',
        system_uid: systemUid || 'NOMA’LUM',
        cadastral_number: cadastralNumber,
        viloyat: viloyatText,
        tuman: matchedTuman.name,
        mahalla: mahallaText,
        address: addressText,
        latitude: null,
        longitude: null,
        location_verified: false,
        source: sourceText,
        source_date: sourceDateText,
        resulting_cadastral_status: 'unverified',
        resulting_marker_color: 'gray',
        messages,
      });
      return;
    }

    // Generate deterministic UID if omitted in file
    if (!systemUid) {
      systemUid = `${matchedMahalla.code}-${String(autoUidCounter++).padStart(4, '0')}`;
      messages.push(`Identifikator bo‘sh bo‘lgani uchun yangi ID (${systemUid}) biriktirildi.`);
    }

    // Check intra-file duplicates
    if (seenUidsInFile.has(systemUid)) {
      messages.push(`Fayl ichida takroriy identifikator (${systemUid}) — qayta kiritilmaydi.`);
      duplicateInFileCount++;
      rows.push({
        rowNumber,
        action: 'duplicate_in_file',
        system_uid: systemUid,
        cadastral_number: cadastralNumber,
        viloyat: viloyatText,
        tuman: matchedTuman.name,
        mahalla: matchedMahalla.name,
        address: addressText,
        latitude: null,
        longitude: null,
        location_verified: false,
        source: sourceText,
        source_date: sourceDateText,
        resulting_cadastral_status: 'unverified',
        resulting_marker_color: 'gray',
        messages,
      });
      return;
    }
    if (cadastralNumber && seenCadsInFile.has(cadastralNumber.toUpperCase())) {
      messages.push(
        `Fayl ichida takroriy kadastr raqami (${cadastralNumber}) — dublikat sifatida ajratildi.`
      );
      duplicateInFileCount++;
      rows.push({
        rowNumber,
        action: 'duplicate_in_file',
        system_uid: systemUid,
        cadastral_number: cadastralNumber,
        viloyat: viloyatText,
        tuman: matchedTuman.name,
        mahalla: matchedMahalla.name,
        address: addressText,
        latitude: null,
        longitude: null,
        location_verified: false,
        source: sourceText,
        source_date: sourceDateText,
        resulting_cadastral_status: 'unverified',
        resulting_marker_color: 'gray',
        messages,
      });
      return;
    }

    seenUidsInFile.add(systemUid);
    if (cadastralNumber) {
      seenCadsInFile.add(cadastralNumber.toUpperCase());
    }

    // Validate Coordinates (do NOT discard record if missing or invalid — TZ Section 8 & 16)
    const parsedLat = parseCoordinate(latRaw);
    const parsedLng = parseCoordinate(lngRaw);
    let finalLat: number | null = parsedLat.value;
    let finalLng: number | null = parsedLng.value;
    let locationVerified = true;

    if (parsedLat.invalidFormat || parsedLng.invalidFormat) {
      finalLat = null;
      finalLng = null;
      locationVerified = false;
      missingCoordsCount++;
      messages.push(
        'Koordinata formati noto‘g‘ri: yozuv yo‘qotilmaydi, kulrang holatda tekshiruvga chiqariladi.'
      );
    } else if (finalLat === null || finalLng === null) {
      finalLat = null;
      finalLng = null;
      locationVerified = false;
      missingCoordsCount++;
      messages.push(
        'Koordinata mavjud emas: obyekt kulrang holatda saqlanadi va joylashuvni aniqlash topshirig‘i ochiladi.'
      );
    } else if (!isValidUzbekistanCoord(finalLat, finalLng)) {
      finalLat = null;
      finalLng = null;
      locationVerified = false;
      missingCoordsCount++;
      messages.push(
        `Koordinata O‘zbekiston chegarasidan tashqarida (${parsedLat.value}, ${parsedLng.value}): tekshiruvga chiqarildi.`
      );
    }

    // Determine cadastral status (CRITICAL RULE: missing cadastre != red!)
    let resultingCadastralStatus: CadastralStatus = 'unverified';
    if (cadastralNumber) {
      const cadRegex = /^\d{2}:\d{2}:\d{2,3}:\d{2}:\d{2}:\d{3,5}$/;
      if (cadRegex.test(cadastralNumber)) {
        resultingCadastralStatus = locationVerified ? 'confirmed' : 'unverified';
      } else {
        resultingCadastralStatus = 'unverified';
        messages.push(
          `Kadastr raqami noodatiy formatda (${cadastralNumber}) — tekshiruvga yuboriladi.`
        );
      }
    } else {
      missingCadastreCount++;
      resultingCadastralStatus = 'unverified';
      messages.push(
        'Kadastr raqami ko‘rsatilmagan — qizil emas, aniqlanmagan (tekshiruv talab) holatda saqlanadi.'
      );
    }

    // Match against existing DB strictly by system_uid or cadastral_number (NEVER auto-merge by address alone!)
    const matchByUid = byUid.get(systemUid);
    const matchByCad = cadastralNumber ? byCad.get(cadastralNumber.toUpperCase()) : undefined;

    let action: ExcelPreviewRow['action'] = 'insert';
    let existingPropertyId: number | undefined;

    if (matchByUid && matchByCad && matchByUid.id !== matchByCad.id) {
      action = 'conflict_review';
      existingPropertyId = matchByUid.id;
      resultingCadastralStatus = 'unverified';
      conflictReviewCount++;
      messages.push(
        `Ziddiyat: ID (${systemUid}) va kadastr raqami (${cadastralNumber}) bazadagi ikki xil obyektga tegishli. Avtomatik birlashtirilmaydi — tekshiruvga yuboriladi.`
      );
    } else if (matchByUid || matchByCad) {
      const existing = matchByUid ?? matchByCad!;
      existingPropertyId = existing.id;
      systemUid = existing.system_uid;
      if (
        existing.address.toLowerCase() !== addressText.toLowerCase() &&
        existing.mahalla_id !== matchedMahalla.id
      ) {
        action = 'conflict_review';
        resultingCadastralStatus = 'unverified';
        conflictReviewCount++;
        messages.push(
          `Mavjud obyekt (${existing.system_uid}) hududi/manzili mos kelmadi — mavjud yozuv o‘chirilmasdan tekshiruv topshirig‘i ochiladi.`
        );
      } else {
        action = 'update';
        validUpdateCount++;
        messages.push(`Mavjud obyekt (${existing.system_uid}) yangilanadi.`);
      }
    } else {
      // Check if address matches an existing house in same mahalla with different ID -> DO NOT auto-merge!
      const sameAddressDifferentId = existingProps.find(
        (p) =>
          p.mahalla_id === matchedMahalla.id &&
          p.address.trim().toLowerCase() === addressText.trim().toLowerCase()
      );
      if (sameAddressDifferentId) {
        action = 'conflict_review';
        resultingCadastralStatus = 'unverified';
        conflictReviewCount++;
        messages.push(
          `Xuddi shu manzilda "${sameAddressDifferentId.system_uid}" obyekti mavjud. Faqat manzil bo‘yicha avtomatik birlashtirish taqiqlangan — alohida tekshiruvga chiqariladi.`
        );
      } else {
        action = 'insert';
        validInsertCount++;
      }
    }

    const resultingMarkerColor = computeMarkerColor({
      cadastral_status: resultingCadastralStatus,
      latitude: finalLat,
      longitude: finalLng,
      location_verified: locationVerified,
    });

    rows.push({
      rowNumber,
      action,
      system_uid: systemUid,
      cadastral_number: cadastralNumber,
      viloyat: viloyatDefault.name,
      tuman: matchedTuman.name,
      mahalla: matchedMahalla.name,
      address: addressText,
      latitude: finalLat,
      longitude: finalLng,
      location_verified: locationVerified,
      source: sourceText,
      source_date: sourceDateText,
      resulting_cadastral_status: resultingCadastralStatus,
      resulting_marker_color: resultingMarkerColor,
      messages,
      existing_property_id: existingPropertyId,
      tuman_id: matchedTuman.id,
      mahalla_id: matchedMahalla.id,
    });
  });

  const previewToken = crypto.randomBytes(16).toString('hex');
  const preview: ExcelPreviewResponse = {
    previewToken,
    filename,
    totalRows: rawRows.length,
    validInsertCount,
    validUpdateCount,
    conflictReviewCount,
    duplicateInFileCount,
    errorCount,
    missingCoordsCount,
    missingCadastreCount,
    columnsDetected,
    rows,
  };

  previewStore.set(previewToken, {
    createdAt: Date.now(),
    uploadedBy: user.id,
    preview,
  });

  return preview;
}

export function commitExcelPreview(previewToken: string, user: AuthUser) {
  const cached = previewStore.get(previewToken);
  if (!cached) {
    throw new Error('Ko‘rib chiqish sessiyasi topilmadi yoki muddati tugagan. Faylni qayta yuklang.');
  }

  const { preview } = cached;
  const viloyat = (db.prepare("SELECT id FROM regions WHERE level = 'viloyat' LIMIT 1").get() as {
    id: number;
  }) ?? { id: 1 };

  let insertedCount = 0;
  let updatedCount = 0;
  let flaggedCount = 0;
  const errorDetails: { row: number; message: string }[] = [];

  const tx = db.transaction(() => {
    const insertPropStmt = db.prepare(`
      INSERT INTO properties (
        system_uid, viloyat_id, tuman_id, mahalla_id, address, object_type,
        latitude, longitude, location_verified, cadastral_number,
        cadastral_status, inspection_status, source, source_date, assigned_user_id, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'residential_house', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const updatePropStmt = db.prepare(`
      UPDATE properties
      SET address = ?,
          latitude = COALESCE(?, latitude),
          longitude = COALESCE(?, longitude),
          location_verified = CASE WHEN ? IS NOT NULL AND ? IS NOT NULL THEN 1 ELSE location_verified END,
          cadastral_number = COALESCE(?, cadastral_number),
          cadastral_status = CASE
            WHEN cadastral_status = 'confirmed_absent' AND ? IS NULL THEN 'confirmed_absent'
            WHEN ? = 'confirmed' THEN 'confirmed'
            ELSE cadastral_status
          END,
          source = ?,
          source_date = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    const insertTaskStmt = db.prepare(`
      INSERT INTO tasks (
        property_id, assigned_to, created_by, reason, status, due_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, date('now', '+10 days'), datetime('now'), datetime('now'))
    `);

    const findInspectorForTuman = db.prepare(`
      SELECT id FROM users WHERE role = 'inspector' AND tuman_id = ? AND is_blocked = 0 LIMIT 1
    `);

    for (const row of preview.rows) {
      if (row.action === 'error' || row.action === 'duplicate_in_file') {
        errorDetails.push({
          row: row.rowNumber,
          message: row.messages.join(' ') || 'Xatolik yoki dublikat',
        });
        continue;
      }

      const defaultInspector = row.tuman_id
        ? (findInspectorForTuman.get(row.tuman_id) as { id: number } | undefined)
        : undefined;
      const assignedId = defaultInspector?.id ?? null;

      if (row.action === 'insert') {
        const needsCheck =
          row.resulting_cadastral_status !== 'confirmed' || !row.location_verified;
        const inspStatus = needsCheck
          ? assignedId
            ? 'assigned'
            : 'sent_for_inspection'
          : 'completed';

        const propId = Number(
          insertPropStmt.run(
            row.system_uid,
            viloyat.id,
            row.tuman_id!,
            row.mahalla_id!,
            row.address,
            row.latitude,
            row.longitude,
            row.location_verified ? 1 : 0,
            row.cadastral_number,
            row.resulting_cadastral_status,
            inspStatus,
            row.source,
            row.source_date,
            needsCheck ? assignedId : null,
            row.messages.join(' ') || null
          ).lastInsertRowid
        );
        insertedCount++;

        if (needsCheck) {
          flaggedCount++;
          insertTaskStmt.run(
            propId,
            assignedId,
            user.id,
            row.messages[0] || 'Excel importda kadastr holati yoki joylashuvni tekshirish talab etiladi',
            inspStatus
          );
        } else if (row.cadastral_number) {
          db.prepare(`
            INSERT INTO cadastral_records (property_id, cadastral_number, source_authority, verification_doc_ref)
            VALUES (?, ?, ?, ?)
          `).run(propId, row.cadastral_number, row.source, `IMP-${row.system_uid}`);
        }
      } else if (row.action === 'update' && row.existing_property_id) {
        updatePropStmt.run(
          row.address,
          row.latitude,
          row.longitude,
          row.latitude,
          row.longitude,
          row.cadastral_number,
          row.cadastral_number,
          row.resulting_cadastral_status,
          row.source,
          row.source_date,
          row.existing_property_id
        );
        updatedCount++;
      } else if (row.action === 'conflict_review') {
        flaggedCount++;
        if (row.existing_property_id) {
          db.prepare(`
            UPDATE properties
            SET inspection_status = 'sent_for_inspection',
                notes = COALESCE(notes || ' | ', '') || ?,
                updated_at = datetime('now')
            WHERE id = ?
          `).run(`[Import tafovuti]: ${row.messages.join(' ')}`, row.existing_property_id);

          insertTaskStmt.run(
            row.existing_property_id,
            assignedId,
            user.id,
            `Excel import tafovuti: ${row.messages.join(' ')}`,
            assignedId ? 'assigned' : 'sent_for_inspection'
          );
        } else {
          // Same address but different ID: insert as separate unverified record for inspection (never auto-merge!)
          const propId = Number(
            insertPropStmt.run(
              row.system_uid,
              viloyat.id,
              row.tuman_id!,
              row.mahalla_id!,
              row.address,
              row.latitude,
              row.longitude,
              row.location_verified ? 1 : 0,
              row.cadastral_number,
              'unverified',
              assignedId ? 'assigned' : 'sent_for_inspection',
              row.source,
              row.source_date,
              assignedId,
              row.messages.join(' ')
            ).lastInsertRowid
          );
          insertedCount++;
          insertTaskStmt.run(
            propId,
            assignedId,
            user.id,
            row.messages.join(' '),
            assignedId ? 'assigned' : 'sent_for_inspection'
          );
        }
      }
    }

    const importId = Number(
      db
        .prepare(`
          INSERT INTO imports (
            filename, uploaded_by, total_rows, inserted_count, updated_count,
            flagged_count, error_count, duplicate_count, errors_json, summary_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `)
        .run(
          preview.filename,
          user.id,
          preview.totalRows,
          insertedCount,
          updatedCount,
          flaggedCount,
          preview.errorCount,
          preview.duplicateInFileCount,
          JSON.stringify(errorDetails),
          JSON.stringify({
            missingCadastreCount: preview.missingCadastreCount,
            missingCoordsCount: preview.missingCoordsCount,
            conflictReviewCount: preview.conflictReviewCount,
          })
        ).lastInsertRowid
    );

    writeAuditLog({
      actor_id: user.id,
      actor_name: user.full_name,
      actor_role: user.role,
      action: 'EXCEL_IMPORT_COMMITTED',
      entity_type: 'imports',
      entity_id: importId,
      summary: `"${preview.filename}" import qilindi: ${insertedCount} yangi, ${updatedCount} yangilangan, ${flaggedCount} tekshiruvga chiqarilgan, ${preview.duplicateInFileCount} dublikat, ${preview.errorCount} xato.`,
    });

    return importId;
  });

  const importId = tx();
  previewStore.delete(previewToken);

  return db
    .prepare(
      `SELECT i.*, u.full_name as uploaded_by_name
       FROM imports i
       LEFT JOIN users u ON u.id = i.uploaded_by
       WHERE i.id = ?`
    )
    .get(importId);
}

export function generateSampleExcelBuffer(mode: 'clean' | 'sample'): Buffer {
  const headers = [
    'Obyekt identifikatori',
    'Kadastr raqami',
    'Viloyat',
    'Tuman',
    'Mahalla',
    'Manzil',
    'Kenglik',
    'Uzunlik',
    'Ma’lumot manbasi',
    'Ma’lumot sanasi',
  ];

  const rows =
    mode === 'clean'
      ? [
          [
            'AND-BOB-0901',
            '17:03:401:01:02:0901',
            'Andijon viloyati',
            'Andijon shahri',
            'Boburshoh MFY',
            'Boburshoh shoh ko‘chasi, 55-uy',
            '40.784420',
            '72.346510',
            'Kadastr reyestri',
            '2026-10-29',
          ],
        ]
      : [
          [
            'AND-BOB-0501',
            '17:03:401:01:05:0501',
            'Andijon viloyati',
            'Andijon shahri',
            'Boburshoh MFY',
            'Cho‘lpon shoh ko‘chasi, 62-uy',
            '40.783150',
            '72.347420',
            'Davlat kadastr reyestri',
            '2026-10-28',
          ],
          [
            'AND-MUS-0502',
            '',
            'Andijon viloyati',
            'Andijon shahri',
            'Mustaqillik MFY',
            'Mustaqillik ko‘chasi, 39-uy',
            '40.791120',
            '72.339050',
            'Xatlov ro‘yxati 2026',
            '2026-10-28',
          ],
          [
            'ASA-CHO-0503',
            '',
            'Andijon viloyati',
            'Asaka tumani',
            'Cho‘ntak MFY',
            'Imom Buxoriy ko‘chasi, 71-uy',
            '',
            '',
            'Tuman hokimligi ro‘yxati',
            '2026-10-28',
          ],
          [
            'AND-BOB-0501',
            '17:03:401:01:05:0501',
            'Andijon viloyati',
            'Andijon shahri',
            'Boburshoh MFY',
            'Cho‘lpon shoh ko‘chasi, 62-uy (dublikat qator)',
            '40.783150',
            '72.347420',
            'Davlat kadastr reyestri',
            '2026-10-28',
          ],
          [
            'AND-BOB-0505',
            '',
            'Andijon viloyati',
            'Andijon shahri',
            'Boburshoh MFY',
            'Boburshoh shoh ko‘chasi, 14-uy',
            '40.783690',
            '72.345190',
            'Mahalla xabarnomasi (manzil ziddiyati)',
            '2026-10-28',
          ],
          [
            'XON-ANH-0506',
            '17:03:408:01:02:0506',
            'Andijon viloyati',
            'Xonobod shahri',
            'Anhor MFY',
            'Anhor bo‘yi ko‘chasi, 25-uy',
            '99.123456',
            '72.974100',
            'Texnik inventarizatsiya (noto‘g‘ri kenglik)',
            '2026-10-28',
          ],
          [
            'ERR-ROW-0507',
            '',
            'Andijon viloyati',
            'Andijon shahri',
            'Boburshoh MFY',
            '',
            '40.783000',
            '72.344000',
            'Xato qator (manzil yo‘q)',
            '2026-10-28',
          ],
        ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 6, 18) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Kadastr_Obyektlar');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function generateReportsExcelBuffer(user: AuthUser): Buffer {
  const scope = buildPropertyScopeClause(user, 'p');

  // Strictly count by DISTINCT p.system_uid (TZ Section 11)
  const regionBreakdown = db
    .prepare(
      `
      SELECT
        t.name as tuman_name,
        m.name as mahalla_name,
        COUNT(DISTINCT p.system_uid) as total_objects,
        COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed' THEN p.system_uid END) as confirmed_count,
        COUNT(DISTINCT CASE WHEN p.cadastral_status = 'confirmed_absent' THEN p.system_uid END) as confirmed_absent_count,
        COUNT(DISTINCT CASE WHEN p.cadastral_status = 'unverified' THEN p.system_uid END) as unverified_count,
        COUNT(DISTINCT CASE WHEN p.inspection_status IN ('sent_for_inspection','assigned','in_progress','reopened') THEN p.system_uid END) as in_inspection_count,
        COUNT(DISTINCT CASE WHEN p.inspection_status = 'needs_info' THEN p.system_uid END) as needs_info_count,
        COUNT(DISTINCT CASE WHEN p.inspection_status = 'completed' THEN p.system_uid END) as completed_inspection_count
      FROM properties p
      JOIN regions t ON t.id = p.tuman_id
      JOIN regions m ON m.id = p.mahalla_id
      WHERE ${scope.sql}
      GROUP BY t.id, m.id
      ORDER BY t.name, m.name
    `
    )
    .all(...scope.params) as Record<string, unknown>[];

  const propertiesList = db
    .prepare(
      `
      SELECT
        p.system_uid,
        v.name as viloyat_name,
        t.name as tuman_name,
        m.name as mahalla_name,
        p.address,
        p.cadastral_number,
        p.cadastral_status,
        p.inspection_status,
        p.latitude,
        p.longitude,
        p.source,
        u.full_name as inspector_name,
        p.last_inspected_at
      FROM properties p
      JOIN regions v ON v.id = p.viloyat_id
      JOIN regions t ON t.id = p.tuman_id
      JOIN regions m ON m.id = p.mahalla_id
      LEFT JOIN users u ON u.id = p.assigned_user_id
      WHERE ${scope.sql}
      ORDER BY p.system_uid ASC
    `
    )
    .all(...scope.params) as Record<string, any>[];

  const tasksList = db
    .prepare(
      `
      SELECT
        tk.id,
        p.system_uid,
        t.name as tuman_name,
        m.name as mahalla_name,
        p.address,
        u.full_name as assigned_name,
        tk.status,
        tk.due_date,
        tk.reason,
        tk.result_summary,
        tk.created_at
      FROM tasks tk
      JOIN properties p ON p.id = tk.property_id
      JOIN regions t ON t.id = p.tuman_id
      JOIN regions m ON m.id = p.mahalla_id
      LEFT JOIN users u ON u.id = tk.assigned_to
      WHERE ${scope.sql}
      ORDER BY tk.id DESC
    `
    )
    .all(...scope.params) as Record<string, any>[];

  const wb = XLSX.utils.book_new();

  const sheet1Rows = [
    [
      'Tuman / Shahar',
      'Mahalla (MFY)',
      'Jami noyob obyektlar',
      'Tasdiqlangan (Yashil)',
      'Kadastr yo‘qligi tasdiqlangan (Qizil)',
      'Aniqlanmagan',
      'Tekshiruv jarayonida',
      'Qo‘shimcha ma’lumot talab',
      'Tekshiruv yakunlangan',
    ],
    ...regionBreakdown.map((r: any) => [
      r.tuman_name,
      r.mahalla_name,
      r.total_objects,
      r.confirmed_count,
      r.confirmed_absent_count,
      r.unverified_count,
      r.in_inspection_count,
      r.needs_info_count,
      r.completed_inspection_count,
    ]),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Rows);
  ws1['!cols'] = sheet1Rows[0].map((h) => ({ wch: Math.max(String(h).length + 4, 16) }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Hududlar_Kesimida');

  const sheet2Rows = [
    [
      'Yagona ID',
      'Viloyat',
      'Tuman',
      'Mahalla',
      'Manzil',
      'Kadastr raqami',
      'Kadastr holati',
      'Tekshiruv holati',
      'Kenglik',
      'Uzunlik',
      'Manba',
      'Mas’ul xodim',
      'Oxirgi tekshiruv sanasi',
    ],
    ...propertiesList.map((p) => [
      p.system_uid,
      p.viloyat_name,
      p.tuman_name,
      p.mahalla_name,
      p.address,
      p.cadastral_number ?? '—',
      CADASTRAL_STATUS_LABELS[p.cadastral_status as CadastralStatus] ?? p.cadastral_status,
      INSPECTION_STATUS_LABELS[p.inspection_status as keyof typeof INSPECTION_STATUS_LABELS] ??
        p.inspection_status,
      p.latitude ?? 'Aniqlanmagan',
      p.longitude ?? 'Aniqlanmagan',
      p.source,
      p.inspector_name ?? '—',
      p.last_inspected_at ?? '—',
    ]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Rows);
  ws2['!cols'] = sheet2Rows[0].map((h) => ({ wch: Math.max(String(h).length + 5, 16) }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Obyektlar_Reyestri');

  const sheet3Rows = [
    [
      'Topshiriq #',
      'Obyekt ID',
      'Tuman',
      'Mahalla',
      'Manzil',
      'Mas’ul xodim',
      'Holati',
      'Muddati',
      'Tekshiruv sababi',
      'Natija xulosasi',
    ],
    ...tasksList.map((tk) => [
      tk.id,
      tk.system_uid,
      tk.tuman_name,
      tk.mahalla_name,
      tk.address,
      tk.assigned_name ?? 'Biriktirilmagan',
      INSPECTION_STATUS_LABELS[tk.status as keyof typeof INSPECTION_STATUS_LABELS] ?? tk.status,
      tk.due_date ?? '—',
      tk.reason,
      tk.result_summary ?? '—',
    ]),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Rows);
  ws3['!cols'] = sheet3Rows[0].map((h) => ({ wch: Math.max(String(h).length + 5, 16) }));
  XLSX.utils.book_append_sheet(wb, ws3, 'Tekshiruv_Topshiriqlari');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
