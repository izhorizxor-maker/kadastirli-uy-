import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { apiRequest, downloadAuthenticatedFile } from '../api';
import type { AuditLogItem, BackupFileInfo, SystemTestResult } from '../types';

interface AuditBackupViewProps {
  onToast: (msg: string, type?: 'success' | 'error') => void;
  onRestored: () => void;
}

export function AuditBackupView({ onToast, onRestored }: AuditBackupViewProps) {
  const [subTab, setSubTab] = useState<'audit' | 'backup' | 'qa'>('audit');

  // Audit logs state
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const [q, setQ] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(true);

  // Backups state
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [confirmRestoreFilename, setConfirmRestoreFilename] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  // QA Tests state (TZ Section 16 & 19)
  const [testRuns, setTestRuns] = useState<SystemTestResult[]>([]);
  const [runningTests, setRunningTests] = useState(false);

  const loadAuditLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: '15',
      });
      if (q.trim()) qs.set('q', q.trim());
      const res = await apiRequest<{
        items: AuditLogItem[];
        total: number;
        totalPages: number;
      }>(`/api/audit-logs?${qs.toString()}`);
      setLogs(res.items);
      setTotalLogs(res.total);
      setTotalPages(res.totalPages);
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setLoadingLogs(false);
    }
  }, [page, q, onToast]);

  const loadBackups = useCallback(async () => {
    try {
      const res = await apiRequest<BackupFileInfo[]>('/api/backups');
      setBackups(res);
    } catch (err: any) {
      onToast(err.message, 'error');
    }
  }, [onToast]);

  const loadTests = useCallback(async () => {
    try {
      const res = await apiRequest<SystemTestResult[]>('/api/system-tests');
      setTestRuns(res);
    } catch (err: any) {
      onToast(err.message, 'error');
    }
  }, [onToast]);

  useEffect(() => {
    if (subTab === 'audit') loadAuditLogs();
    if (subTab === 'backup') loadBackups();
    if (subTab === 'qa') loadTests();
  }, [subTab, loadAuditLogs, loadBackups, loadTests]);

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const created = await apiRequest<BackupFileInfo>('/api/backups', { method: 'POST' });
      onToast(`Zaxira nusxasi (${created.filename}) yaratildi.`, 'success');
      loadBackups();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    setRestoring(true);
    try {
      await apiRequest(`/api/backups/${encodeURIComponent(filename)}/restore`, {
        method: 'POST',
      });
      onToast('Ma’lumotlar bazasi zaxira nusxasidan muvaffaqiyatli tiklandi.', 'success');
      setConfirmRestoreFilename(null);
      onRestored();
      loadBackups();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setRestoring(false);
    }
  };

  const handleRunVerificationSuite = async () => {
    setRunningTests(true);
    try {
      await apiRequest<SystemTestResult>('/api/system-tests/run', { method: 'POST' });
      onToast('Barcha qabul va xavfsizlik testlari bajarildi hamda hujjatlashtirildi.', 'success');
      loadTests();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setRunningTests(false);
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-[1440px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Harakatlar tarixi, zaxira nusxasi va sinov nazorati
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Tizimdagi barcha muhim amallar jurnali, ma’lumotlar bazasini zaxiralash/tiklash va TZ
            16-bo‘lim sinov bayonnomalari
          </p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setSubTab('audit')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            subTab === 'audit'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Audit jurnali ({totalLogs || '...'})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('backup')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            subTab === 'backup'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Zaxira nusxasi va tiklash
        </button>
        <button
          type="button"
          onClick={() => setSubTab('qa')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            subTab === 'qa'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          TZ qabul sinovlari
        </button>
      </div>

      {/* 1. AUDIT JOURNAL */}
      {subTab === 'audit' && (
        <div className="space-y-4">
          <div className="relative w-full max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Foydalanuvchi, obyekt ID yoki tavsif bo‘yicha qidirish..."
              className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {loadingLogs ? (
              <div className="p-6 text-xs text-slate-500">Yuklanmoqda...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Vaqt</th>
                      <th className="py-2.5 px-3">Foydalanuvchi</th>
                      <th className="py-2.5 px-3">Amal turi</th>
                      <th className="py-2.5 px-3">Obyekt / Yozuv</th>
                      <th className="py-2.5 px-4">Tafsilot</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {log.created_at}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-medium text-slate-900">{log.actor_name}</div>
                          <div className="text-[11px] text-slate-500">{log.actor_role}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-800 whitespace-nowrap">
                          {log.entity_id || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">{log.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
              <div>
                Sahifa <span className="font-mono font-semibold text-slate-900">{page}</span> /{' '}
                <span className="font-mono font-semibold text-slate-900">{totalPages}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1.5 border border-slate-300 bg-white rounded-md disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Oldingi</span>
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1.5 border border-slate-300 bg-white rounded-md disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Keyingi</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. BACKUP & RESTORE */}
      {subTab === 'backup' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="text-sm font-bold text-slate-900">
                Markaziy ma’lumotlar bazasini zaxiralash (SHA-256 nazoratli)
              </h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Har bir zaxira nusxasi barcha 10 ta jadval holatini o‘z ichiga oladi va SHA-256
                yaxlitlik imzosi bilan himoyalanadi. Tiklash tranzaksiya ichida bajariladi.
              </p>
            </div>

            <button
              type="button"
              disabled={creatingBackup}
              onClick={handleCreateBackup}
              className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Database className="w-4 h-4" />
              <span>{creatingBackup ? 'Yaratilmoqda...' : 'Yangi zaxira nusxasini yaratish'}</span>
            </button>
          </div>

          {confirmRestoreFilename && (
            <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="text-amber-950">
                <strong>Diqqat:</strong> Bazani{' '}
                <span className="font-mono font-semibold">{confirmRestoreFilename}</span> zaxira
                holatiga qayta tiklashni tasdiqlaysizmi?
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmRestoreFilename(null)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-700 cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => handleRestoreBackup(confirmRestoreFilename)}
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white font-semibold rounded cursor-pointer"
                >
                  {restoring ? 'Tiklanmoqda...' : 'Tasdiqlash va tiklash'}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Fayl nomi</th>
                  <th className="py-2.5 px-3">Yaratilgan vaqt</th>
                  <th className="py-2.5 px-3">Yaratgan mas’ul</th>
                  <th className="py-2.5 px-3">Hajmi va yozuvlar</th>
                  <th className="py-2.5 px-4 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {backups.map((b) => (
                  <tr key={b.filename} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {b.filename}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600">{b.created_at}</td>
                    <td className="py-3 px-3 text-slate-700">{b.created_by}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                      {Math.max(1, Math.round(b.size_bytes / 1024))} KB · {b.record_counts.properties}{' '}
                      obyekt · {b.record_counts.tasks} topshiriq
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() =>
                          downloadAuthenticatedFile(
                            `/api/backups/${encodeURIComponent(b.filename)}/download`,
                            b.filename
                          ).catch((e) => onToast(e.message, 'error'))
                        }
                        className="px-2.5 py-1 text-xs font-medium border border-slate-300 rounded text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Yuklab olish</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRestoreFilename(b.filename)}
                        className="px-2.5 py-1 text-xs font-semibold border border-blue-300 text-blue-700 hover:bg-blue-50 rounded inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Tiklash</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. TZ SECTION 16 & 19 AUTOMATED ACCEPTANCE TESTS */}
      {subTab === 'qa' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="text-sm font-bold text-slate-900">
                Texnik topshiriq (16 va 19-bo‘limlar) qabul sinovlari bayonnomasi
              </h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Excel import dublikatlari, kadastr yo‘q yozuvning qizilga o‘tmasligi, xarita rang
                ajratilishi, mahalla vakili RBAC izolatsiyasi, noyob obyekt hisoboti va zaxiradan
                tiklash yaxlitligini avtomatik tekshiradi hamda natijani bazaga yozadi.
              </p>
            </div>

            <button
              type="button"
              disabled={runningTests}
              onClick={handleRunVerificationSuite}
              className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{runningTests ? 'Sinovlar bajarilmoqda...' : 'Sinovlarni ishga tushirish'}</span>
            </button>
          </div>

          {testRuns.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-500">
              Sinov bayonnomalari hali shakllantirilmagan. Yuqoridagi tugmani bosib tekshiruvni
              boshlang.
            </div>
          ) : (
            <div className="space-y-4">
              {testRuns.map((run) => {
                let details: {
                  category: string;
                  name: string;
                  passed: boolean;
                  detail: string;
                }[] = [];
                try {
                  details = JSON.parse(run.details_json || '[]');
                } catch {
                  details = [];
                }
                return (
                  <div
                    key={run.id}
                    className="bg-white border border-slate-200 rounded-lg overflow-hidden"
                  >
                    <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 font-bold text-slate-900">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span>
                          Bayonnoma #{run.id}: {run.suite_name}
                        </span>
                      </div>
                      <div className="font-mono text-slate-600">
                        Natija:{' '}
                        <span className="font-bold text-emerald-700">
                          {run.passed_checks}/{run.total_checks} muvaffaqiyatli
                        </span>{' '}
                        · {run.executed_by_name} · {run.executed_at}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-200 text-xs">
                      {details.map((chk, idx) => (
                        <div
                          key={idx}
                          className="px-5 py-3 flex items-start justify-between gap-4"
                        >
                          <div className="space-y-0.5">
                            <div className="font-semibold text-slate-900">
                              {chk.category} · {chk.name}
                            </div>
                            <div className="text-slate-600">{chk.detail}</div>
                          </div>
                          {chk.passed ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold shrink-0">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>O‘tdi</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-700 font-semibold shrink-0">
                              <XCircle className="w-4 h-4" />
                              <span>Xato</span>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
