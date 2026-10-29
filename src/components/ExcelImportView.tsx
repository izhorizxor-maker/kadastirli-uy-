import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  XCircle,
} from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../api';
import type { ExcelPreviewResponse, ImportBatchItem } from '../types';
import { CadastralStatusText, MarkerCategoryText } from './StatusIndicator';

interface ExcelImportViewProps {
  onToast: (msg: string, type?: 'success' | 'error') => void;
  onImportCompleted: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  insert: 'Yangi kiritiladi',
  update: 'Mavjud yozuv yangilanadi',
  conflict_review: 'Tafovut — tekshiruvga chiqariladi',
  duplicate_in_file: 'Fayl ichida dublikat (o‘tkazib yuboriladi)',
  error: 'Format / majburiy maydon xatosi',
};

export function ExcelImportView({ onToast, onImportCompleted }: ExcelImportViewProps) {
  const [history, setHistory] = useState<ImportBatchItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<ExcelPreviewResponse | null>(null);
  const [rowFilter, setRowFilter] = useState<string>('all');
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await apiRequest<ImportBatchItem[]>('/api/imports');
      setHistory(res);
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiRequest<ExcelPreviewResponse>('/api/imports/preview', {
          method: 'POST',
          body: JSON.stringify({
            filename: file.name,
            fileBase64: String(reader.result || ''),
          }),
        });
        setPreview(res);
        setRowFilter('all');
        onToast(`"${file.name}" tekshiruvdan o‘tkazildi — importdan oldin natijani ko‘rib chiqing.`, 'success');
      } catch (err: any) {
        onToast(err.message, 'error');
      } finally {
        setUploading(false);
        e.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCommit = async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      await apiRequest('/api/imports/commit', {
        method: 'POST',
        body: JSON.stringify({ previewToken: preview.previewToken }),
      });
      onToast('Tasdiqlangan yozuvlar bazaga muvaffaqiyatli yuklandi.', 'success');
      setPreview(null);
      await loadHistory();
      onImportCompleted();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setCommitting(false);
    }
  };

  const filteredPreviewRows = preview
    ? preview.rows.filter((r) => (rowFilter === 'all' ? true : r.action === rowFilter))
    : [];

  return (
    <div className="p-6 space-y-6 max-w-[1440px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Excel orqali kadastr ma’lumotlarini ommaviy yuklash
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Fayl ustunlari, koordinatalar, dublikatlar va manzil ziddiyatlari bazaga yozishdan
            oldin avtomatik tekshiriladi
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadAuthenticatedFile(
                '/api/imports/template.xlsx?mode=clean',
                'ekadastr_shablon_bosh.xlsx'
              ).catch((e) => onToast(e.message, 'error'))
            }
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Bo‘sh shablon (.xlsx)</span>
          </button>

          <button
            type="button"
            onClick={() =>
              downloadAuthenticatedFile(
                '/api/imports/template.xlsx?mode=sample',
                'ekadastr_andijon_sinov_namuna.xlsx'
              ).catch((e) => onToast(e.message, 'error'))
            }
            className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-blue-700 hover:bg-blue-50 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Sinov faylini yuklab olish (7 qatorli test)</span>
          </button>
        </div>
      </div>

      {/* Upload Dropzone & Recommended Columns Guide */}
      {!preview && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
              <Upload className="w-6 h-6 text-slate-700" />
            </div>
            <div className="space-y-1 max-w-md">
              <h2 className="text-sm font-bold text-slate-900">
                Excel yoki CSV jadval faylini tanlang
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Qo‘llab-quvvatlanadigan formatlar: <span className="font-mono">.xlsx</span>,{' '}
                <span className="font-mono">.xls</span>, <span className="font-mono">.csv</span>.
                Jadvaldagi formulalar xavfsizlik maqsadida bajarilmaydi.
              </p>
            </div>
            <label className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span>{uploading ? 'Fayl tekshirilmoqda...' : 'Excel faylini tanlash'}</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={uploading}
                onChange={handleFileSelected}
                className="hidden"
              />
            </label>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              Tavsiya etiladigan 10 ta ustun va import qoidalari
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-slate-700 font-mono text-[11px] bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span>01. Obyekt identifikatori</span>
              <span>06. Manzil (majburiy)</span>
              <span>02. Kadastr raqami</span>
              <span>07. Kenglik (latitude)</span>
              <span>03. Viloyat</span>
              <span>08. Uzunlik (longitude)</span>
              <span>04. Tuman (majburiy)</span>
              <span>09. Ma’lumot manbasi</span>
              <span>05. Mahalla (majburiy)</span>
              <span>10. Ma’lumot sanasi</span>
            </div>
            <ul className="space-y-1.5 text-slate-600 leading-relaxed">
              <li>
                · Kadastr raqami bo‘sh bo‘lgan obyekt <strong>qizil rangga o‘tkazilmaydi</strong> —
                aniqlanmagan holatda tekshiruvga yuboriladi.
              </li>
              <li>
                · Koordinatasi yo‘q yoki xato yozuvlar yo‘qotilmaydi — kulrang holatda saqlanadi.
              </li>
              <li>
                · Faqat manzil bo‘yicha avtomatik birlashtirish taqiqlangan; tafovutlar alohida
                tekshiruvga chiqariladi.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Interactive Pre-Import Preview Window (TZ Section 8) */}
      {preview && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden space-y-0">
          <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-slate-50">
            <div>
              <div className="text-xs text-slate-500">Import oldidan ko‘rib chiqish oynasi</div>
              <h2 className="text-base font-bold text-slate-900 mt-0.5">
                {preview.filename} · Jami {preview.totalRows} qator tahlil qilindi
              </h2>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={committing}
                onClick={() => setPreview(null)}
                className="px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                disabled={
                  committing ||
                  preview.validInsertCount +
                    preview.validUpdateCount +
                    preview.conflictReviewCount ===
                    0
                }
                onClick={handleCommit}
                className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {committing
                    ? 'Bazaga yozilmoqda...'
                    : `Tasdiqlash va bazaga kiritish (${
                        preview.validInsertCount +
                        preview.validUpdateCount +
                        preview.conflictReviewCount
                      } ta)`}
                </span>
              </button>
            </div>
          </div>

          {/* Preview Breakdown Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 text-xs">
            <div className="p-3.5">
              <div className="text-slate-500">Yangi obyektlar</div>
              <div className="text-lg font-bold font-mono text-emerald-700 mt-0.5">
                {preview.validInsertCount}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-slate-500">Yangilanadigan</div>
              <div className="text-lg font-bold font-mono text-blue-700 mt-0.5">
                {preview.validUpdateCount}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-slate-500">Ziddiyat / Tekshiruvga</div>
              <div className="text-lg font-bold font-mono text-amber-700 mt-0.5">
                {preview.conflictReviewCount}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-slate-500">Fayl ichida dublikat</div>
              <div className="text-lg font-bold font-mono text-slate-700 mt-0.5">
                {preview.duplicateInFileCount}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-slate-500">Xatoli (rad etilgan)</div>
              <div className="text-lg font-bold font-mono text-red-700 mt-0.5">
                {preview.errorCount}
              </div>
            </div>
          </div>

          {/* Filter Tabs for Preview Rows */}
          <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center gap-1 bg-white">
            {[
              { id: 'all', label: `Barchasi (${preview.rows.length})` },
              { id: 'insert', label: `Yangi (${preview.validInsertCount})` },
              { id: 'update', label: `Yangilanish (${preview.validUpdateCount})` },
              { id: 'conflict_review', label: `Tafovut (${preview.conflictReviewCount})` },
              { id: 'duplicate_in_file', label: `Dublikat (${preview.duplicateInFileCount})` },
              { id: 'error', label: `Xatoli (${preview.errorCount})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setRowFilter(t.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${
                  rowFilter === t.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Preview Table */}
          <div className="overflow-x-auto max-h-[440px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">Qator</th>
                  <th className="py-2.5 px-3">Amal</th>
                  <th className="py-2.5 px-3">ID va Kadastr</th>
                  <th className="py-2.5 px-3">Hudud va Manzil</th>
                  <th className="py-2.5 px-3">Natijaviy holat</th>
                  <th className="py-2.5 px-4">Tekshiruv xulosasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredPreviewRows.map((r) => (
                  <tr key={r.rowNumber} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono text-slate-500">#{r.rowNumber}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {r.action === 'error' ? (
                        <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Xatoli yozuv</span>
                        </span>
                      ) : r.action === 'duplicate_in_file' ? (
                        <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Dublikat</span>
                        </span>
                      ) : r.action === 'conflict_review' ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Tafovut (Tekshiruvga)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{ACTION_LABELS[r.action]}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <div className="font-semibold text-slate-900">{r.system_uid}</div>
                      <div className="text-[11px] text-slate-500">{r.cadastral_number || '—'}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-slate-900">{r.address}</div>
                      <div className="text-[11px] text-slate-500">
                        {r.tuman} · {r.mahalla}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <CadastralStatusText status={r.resulting_cadastral_status} />
                      <div className="mt-0.5">
                        <MarkerCategoryText color={r.resulting_marker_color} />
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 max-w-sm">
                      {r.messages.length === 0 ? 'Barcha maydonlar va koordinata to‘g‘ri.' : r.messages.join(' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historical Imports Log */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">Bajarilgan Excel importlar tarixi</h2>
        </div>

        {loadingHistory ? (
          <div className="p-6 text-xs text-slate-500">Yuklanmoqda...</div>
        ) : history.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">Hali import amalga oshirilmagan.</div>
        ) : (
          <div className="divide-y divide-slate-200 text-xs">
            {history.map((imp) => {
              let parsedErrors: { row: number; message: string }[] = [];
              try {
                parsedErrors = JSON.parse(imp.errors_json || '[]');
              } catch {
                parsedErrors = [];
              }
              const isExpanded = expandedBatchId === imp.id;

              return (
                <div key={imp.id} className="p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{imp.filename}</div>
                      <div className="text-[11px] text-slate-500">
                        Yuklagan: {imp.uploaded_by_name || 'Administrator'} · {imp.created_at}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
                      <span>Jami: {imp.total_rows}</span>
                      <span className="text-emerald-700">Kiritildi: {imp.inserted_count}</span>
                      <span className="text-blue-700">Yangilandi: {imp.updated_count}</span>
                      <span className="text-amber-700">Tekshiruvga: {imp.flagged_count}</span>
                      <span className="text-slate-600">Dublikat: {imp.duplicate_count}</span>
                      <span className="text-red-700">Xato: {imp.error_count}</span>
                      {parsedErrors.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedBatchId(isExpanded ? null : imp.id)}
                          className="font-sans text-blue-700 hover:underline font-medium cursor-pointer"
                        >
                          {isExpanded ? 'Xatolarni yopish' : 'Xatolar va dublikatlar'}
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && parsedErrors.length > 0 && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-[11px] text-slate-700">
                      {parsedErrors.map((err, idx) => (
                        <div key={idx}>
                          <span className="font-mono font-semibold text-slate-900">
                            Qator #{err.row}:
                          </span>{' '}
                          {err.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
