import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../api';
import type { AuthUser, ImportBatchItem } from '../types';

interface ReportsViewProps {
  currentUser: AuthUser;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

interface ReportsPayload {
  byMahalla: {
    tuman_id: number;
    tuman_name: string;
    mahalla_id: number;
    mahalla_name: string;
    total_objects: number;
    confirmed_count: number;
    confirmed_absent_count: number;
    unverified_count: number;
    in_inspection_count: number;
    needs_info_count: number;
    completed_count: number;
  }[];
  inspectorStats: {
    id: number;
    full_name: string;
    tuman_name: string | null;
    total_tasks: number;
    completed_tasks: number;
    active_tasks: number;
    needs_info_tasks: number;
    overdue_tasks: number;
  }[];
  importsSummary: ImportBatchItem[];
}

export function ReportsView({ currentUser, onToast }: ReportsViewProps) {
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiRequest<ReportsPayload>('/api/reports/summary')
      .then((res) => setData(res))
      .catch((err) => onToast(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [onToast]);

  const handleDownloadExcel = async () => {
    setExporting(true);
    try {
      await downloadAuthenticatedFile(
        '/api/reports/export.xlsx',
        `ekadastr_hisobot_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      onToast('Ko‘p varaqli Excel hisoboti (.xlsx) yuklab olindi.', 'success');
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
        <div className="h-80 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  const totals = data.byMahalla.reduce(
    (acc, r) => ({
      total: acc.total + Number(r.total_objects),
      confirmed: acc.confirmed + Number(r.confirmed_count),
      absent: acc.absent + Number(r.confirmed_absent_count),
      unverified: acc.unverified + Number(r.unverified_count),
      inInsp: acc.inInsp + Number(r.in_inspection_count),
      needsInfo: acc.needsInfo + Number(r.needs_info_count),
      completed: acc.completed + Number(r.completed_count),
    }),
    { total: 0, confirmed: 0, absent: 0, unverified: 0, inInsp: 0, needsInfo: 0, completed: 0 }
  );

  return (
    <div className="p-6 space-y-6 max-w-[1440px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Hisobotlar va statistika</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Barcha ko‘rsatkichlar yagona obyekt identifikatori (<span className="font-mono">system_uid</span>)
            bo‘yicha takrorlanmasdan hisoblangan
          </p>
        </div>

        <button
          type="button"
          disabled={exporting}
          onClick={handleDownloadExcel}
          className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>{exporting ? 'Shakllantirilmoqda...' : 'Excel (.xlsx) hisobotni yuklab olish'}</span>
        </button>
      </div>

      {/* Deduplicated Summary Totals Strip */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="pt-2 sm:pt-0 sm:px-3 first:pl-0">
          <div className="text-xs text-slate-500">Jami noyob obyektlar</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {totals.total}
          </div>
        </div>
        <div className="pt-2 sm:pt-0 sm:px-3">
          <div className="text-xs text-slate-500">Tasdiqlangan</div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
            {totals.confirmed}
          </div>
        </div>
        <div className="pt-2 sm:pt-0 sm:px-3">
          <div className="text-xs text-slate-500">Yo‘qligi tasdiqlangan</div>
          <div className="text-xl font-bold font-mono tabular-nums text-red-700 mt-0.5">
            {totals.absent}
          </div>
        </div>
        <div className="pt-2 sm:pt-0 sm:px-3">
          <div className="text-xs text-slate-500">Aniqlanmagan</div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-700 mt-0.5">
            {totals.unverified}
          </div>
        </div>
        <div className="pt-2 sm:pt-0 sm:px-3">
          <div className="text-xs text-slate-500">Tekshiruv jarayonida</div>
          <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-0.5">
            {totals.inInsp}
          </div>
        </div>
        <div className="pt-2 sm:pt-0 sm:px-3">
          <div className="text-xs text-slate-500">Qo‘shimcha ma’lumot talab</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-800 mt-0.5">
            {totals.needsInfo}
          </div>
        </div>
      </div>

      {/* Mahalla & Tuman Breakdown Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            Tuman va mahallalar kesimida kadastr nazorati ko‘rsatkichlari
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Tuman / Shahar</th>
                <th className="py-2.5 px-3">Mahalla (MFY)</th>
                <th className="py-2.5 px-3 text-right">Jami</th>
                <th className="py-2.5 px-3 text-right">Tasdiqlangan</th>
                <th className="py-2.5 px-3 text-right">Yo‘qligi tasdiq.</th>
                <th className="py-2.5 px-3 text-right">Aniqlanmagan</th>
                <th className="py-2.5 px-3 text-right">Tekshiruvda</th>
                <th className="py-2.5 px-3 text-right">Qo‘shimcha ma’l.</th>
                <th className="py-2.5 px-4">Aniqlanganlik ulushi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {data.byMahalla.map((row) => {
                const resolved =
                  Number(row.confirmed_count) + Number(row.confirmed_absent_count);
                const pct =
                  row.total_objects > 0
                    ? Math.round((resolved / Number(row.total_objects)) * 100)
                    : 0;
                return (
                  <tr key={row.mahalla_id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 text-slate-700">{row.tuman_name}</td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{row.mahalla_name}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {row.total_objects}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {row.confirmed_count}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-red-700">
                      {row.confirmed_absent_count}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700">
                      {row.unverified_count}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-blue-700">
                      {row.in_inspection_count}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.needs_info_count}
                    </td>
                    <td className="py-2.5 px-4 w-44">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-600 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums text-[11px] text-slate-700 w-9 text-right">
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspector Workload & Overdue Tasks */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            Kadastr xodimlariga biriktirilgan va muddati o‘tgan topshiriqlar
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Mas’ul xodim</th>
                <th className="py-2.5 px-3">Biriktirilgan tuman</th>
                <th className="py-2.5 px-3 text-right">Jami topshiriq</th>
                <th className="py-2.5 px-3 text-right">Jarayonda</th>
                <th className="py-2.5 px-3 text-right">Yakunlangan</th>
                <th className="py-2.5 px-3 text-right">Qo‘shimcha ma’l.</th>
                <th className="py-2.5 px-4 text-right">Muddati o‘tgan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {data.inspectorStats.map((ins) => (
                <tr key={ins.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-medium text-slate-900">{ins.full_name}</td>
                  <td className="py-2.5 px-3 text-slate-600">{ins.tuman_name || '—'}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                    {ins.total_tasks || 0}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-blue-700">
                    {ins.active_tasks || 0}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                    {ins.completed_tasks || 0}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700">
                    {ins.needs_info_tasks || 0}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700 font-semibold">
                    {ins.overdue_tasks || 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Admin Excel Imports Summary */}
      {currentUser.role === 'admin' && data.importsSummary.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-900">
              Excel import natijalari va xatolar hisoboti
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Fayl nomi</th>
                  <th className="py-2.5 px-3">Yuklagan xodim</th>
                  <th className="py-2.5 px-3 text-right">Jami qator</th>
                  <th className="py-2.5 px-3 text-right">Kiritilgan</th>
                  <th className="py-2.5 px-3 text-right">Yangilangan</th>
                  <th className="py-2.5 px-3 text-right">Dublikat</th>
                  <th className="py-2.5 px-4 text-right">Xatoli qator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {data.importsSummary.map((imp) => (
                  <tr key={imp.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-medium text-slate-900">{imp.filename}</td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {imp.uploaded_by_name} · {imp.created_at}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {imp.total_rows}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {imp.inserted_count}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-blue-700">
                      {imp.updated_count}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                      {imp.duplicate_count}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700">
                      {imp.error_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
