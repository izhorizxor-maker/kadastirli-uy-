import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Lock,
  Map as MapIcon,
  MapPinOff,
  ShieldCheck,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { apiRequest, setAuthToken } from '../api';
import type { AuditLogItem, AuthUser, TaskItem, UserRole } from '../types';
import { ROLE_DEMO_ACCOUNTS } from './LoginView';
import { CadastralStatusText, InspectionStatusText } from './StatusIndicator';

interface DashboardViewProps {
  currentUser: AuthUser;
  onNavigate: (tab: string) => void;
  onOpenProperty: (id: number) => void;
  onFlyToPropertyOnMap: (propId: number, lat: number | null, lng: number | null) => void;
  onSwitchUser: (user: AuthUser) => void;
}

interface DashboardPayload {
  stats: {
    total_objects: number;
    green_confirmed: number;
    yellow_needs_check: number;
    red_confirmed_absent: number;
    gray_unlocated: number;
    cad_confirmed: number;
    cad_absent: number;
    cad_unverified: number;
    active_inspections: number;
    needs_info_count: number;
    completed_inspections: number;
    pending_location_fixes: number;
    overdue_tasks: number;
  };
  recentTasks: TaskItem[];
  mahallaSummary: {
    tuman_name: string;
    mahalla_id: number;
    mahalla_name: string;
    total: number;
    confirmed: number;
    absent: number;
    unverified: number;
  }[];
  recentLogs: AuditLogItem[];
}

export function DashboardView({
  currentUser,
  onNavigate,
  onOpenProperty,
  onFlyToPropertyOnMap,
  onSwitchUser,
}: DashboardViewProps) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [switchRoleModal, setSwitchRoleModal] = useState<UserRole | null>(null);
  const [switchUsername, setSwitchUsername] = useState('');
  const [switchPassword, setSwitchPassword] = useState('');
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const openRoleSwitch = (targetRole: UserRole) => {
    if (targetRole === currentUser.role) {
      if (targetRole === 'admin') onNavigate('users');
      else if (targetRole === 'inspector') onNavigate('tasks');
      else onNavigate('map');
      return;
    }
    const defAcc = ROLE_DEMO_ACCOUNTS.find((a) => a.role === targetRole);
    setSwitchUsername(defAcc?.username ?? '');
    setSwitchPassword(defAcc?.password ?? '');
    setSwitchError(null);
    setSwitchRoleModal(targetRole);
  };

  const handleConfirmSwitch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSwitchError(null);
    setSwitching(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: switchUsername, password: switchPassword }),
      });
      setAuthToken(res.token);
      setSwitchRoleModal(null);
      onSwitchUser(res.user);
    } catch (err: any) {
      setSwitchError(err.message || 'Kirishda xatolik yuz berdi.');
    } finally {
      setSwitching(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<DashboardPayload>('/api/dashboard')
      .then((res) => {
        if (active) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="p-4 border border-red-200 bg-red-50 rounded-lg text-sm text-red-800">
          {error || 'Ma’lumotlarni yuklab bo‘lmadi.'}
        </div>
      </div>
    );
  }

  const { stats } = data;

  return (
    <div className="p-6 space-y-6 max-w-[1440px] mx-auto">
      {/* 3 Role Workspace Buttons on Bosh sahifa: Admin | Kadastr xodimi | Mahalla yettiligi */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-600">
          <span className="font-semibold text-slate-900">Tizim bo‘g‘inlari:</span>{' '}
          Boshqa bo‘limga o‘tish yoki faol ish oynasini ochish uchun tanlang
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { role: 'admin' as UserRole, label: 'Admin', icon: ShieldCheck },
            { role: 'inspector' as UserRole, label: 'Kadastr xodimi', icon: Building2 },
            { role: 'mahalla' as UserRole, label: 'Mahalla yettiligi', icon: Users },
          ].map((btn) => {
            const Icon = btn.icon;
            const isActiveRole = currentUser.role === btn.role;
            return (
              <button
                key={btn.role}
                type="button"
                onClick={() => openRoleSwitch(btn.role)}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg border inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActiveRole
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50 hover:border-slate-400'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActiveRole ? 'text-blue-400' : 'text-slate-500'}`} />
                <span>{btn.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scope & Quick Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Boshqaruv va nazorat paneli</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Vakolat doirasi:{' '}
            <span className="font-medium text-slate-700">
              {currentUser.mahalla_name
                ? `${currentUser.tuman_name} · ${currentUser.mahalla_name}`
                : currentUser.tuman_name
                ? `${currentUser.viloyat_name} · ${currentUser.tuman_name}`
                : currentUser.viloyat_name || 'Andijon viloyati ( barcha hududlar )'}
            </span>{' '}
            · Jami noyob hisobdagi obyektlar:{' '}
            <span className="font-mono font-semibold text-slate-900">{stats.total_objects}</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {currentUser.role === 'admin' && (
            <button
              type="button"
              onClick={() => onNavigate('import')}
              className="px-3.5 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Excel yuklash</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('map')}
            className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>Sun’iy yo‘ldosh xaritasini ochish</span>
          </button>
        </div>
      </div>

      {/* 4 Semantic Map Categories KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Tasdiqlangan (Yashil)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {stats.green_confirmed}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Vakolatli reyestr va koordinatasi tasdiqlangan
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Tekshiruv talab qilinadi (Sariq)</span>
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {stats.yellow_needs_check}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Kadastr holati aniqlanmagan yoki tafovutli
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Yo‘qligi tasdiqlangan (Qizil)</span>
            <XCircle className="w-4 h-4 text-red-600 shrink-0" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {stats.red_confirmed_absent}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Vakolatli xodim tekshiruvi bilan tasdiqlangan
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Joylashuvsiz / Ma’lumotsiz (Kulrang)</span>
            <MapPinOff className="w-4 h-4 text-slate-500 shrink-0" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {stats.gray_unlocated}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Koordinatasi kiritilmagan yoki tekshirilmagan
          </div>
        </div>
      </div>

      {/* Operational Process Counters */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="pt-2 sm:pt-0 sm:px-3 first:pl-0">
          <div className="text-xs text-slate-500">Jarayondagi tekshiruvlar</div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {stats.active_inspections}
          </div>
        </div>
        <div className="pt-2 sm:pt-0 sm:px-3">
          <div className="text-xs text-slate-500">Qo‘shimcha ma’lumot kutilmoqda</div>
          <div className="text-lg font-bold font-mono tabular-nums text-amber-700 mt-0.5">
            {stats.needs_info_count}
          </div>
        </div>
        <div className="pt-2 sm:pt-0 sm:px-3">
          <div className="text-xs text-slate-500">Muddati o‘tgan topshiriqlar</div>
          <div className="text-lg font-bold font-mono tabular-nums text-red-700 mt-0.5">
            {stats.overdue_tasks}
          </div>
        </div>
        <div className="pt-2 sm:pt-0 sm:px-3">
          <div className="text-xs text-slate-500">Joylashuvni tuzatish so‘rovlari</div>
          <div className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-0.5">
            {stats.pending_location_fixes}
          </div>
        </div>
      </div>

      {/* Main Split: Priority Inspection Tasks + Mahalla Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-slate-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Nazoratdagi tekshiruv topshiriqlari
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Barchasi</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {data.recentTasks.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Faol tekshiruv topshiriqlari mavjud emas.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Obyekt / Manzil</th>
                    <th className="py-2.5 px-3">Tekshiruv holati</th>
                    <th className="py-2.5 px-3">Muddati</th>
                    <th className="py-2.5 px-4 text-right">Amal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {data.recentTasks.map((tk) => {
                    const isOverdue =
                      tk.status !== 'completed' &&
                      tk.due_date &&
                      tk.due_date < new Date().toISOString().slice(0, 10);
                    return (
                      <tr key={tk.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4">
                          <div className="font-mono font-semibold text-slate-900">
                            {tk.system_uid}
                          </div>
                          <div className="text-slate-600 truncate max-w-[230px]">
                            {tk.property_address}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {tk.tuman_name} · {tk.mahalla_name}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <InspectionStatusText status={tk.status} />
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {tk.assigned_to_name || 'Biriktirilmagan'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums">
                          <span className={isOverdue ? 'text-red-700 font-semibold' : 'text-slate-700'}>
                            {tk.due_date || '—'}
                          </span>
                          {isOverdue && (
                            <div className="text-[10px] text-red-600">Muddati o‘tgan</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-2">
                          {tk.latitude != null && tk.longitude != null && (
                            <button
                              type="button"
                              onClick={() =>
                                onFlyToPropertyOnMap(
                                  tk.property_id,
                                  tk.latitude ?? null,
                                  tk.longitude ?? null
                                )
                              }
                              className="text-xs font-medium text-slate-600 hover:text-slate-900 underline cursor-pointer"
                            >
                              Xarita
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenProperty(tk.property_id)}
                            className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                          >
                            Karta
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Mahalla Summary Table */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Mahallalar kesimida ko‘rsatkichlar</h2>
            {currentUser.role !== 'mahalla' && (
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
              >
                To‘liq hisobot
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Mahalla</th>
                  <th className="py-2.5 px-2 text-right">Jami</th>
                  <th className="py-2.5 px-2 text-right">Tasdiq.</th>
                  <th className="py-2.5 px-2 text-right">Aniqlanm.</th>
                  <th className="py-2.5 px-4 text-right">Yo‘q</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {data.mahallaSummary.map((m) => (
                  <tr key={m.mahalla_id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{m.mahalla_name}</div>
                      <div className="text-[11px] text-slate-500">{m.tuman_name}</div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {m.total}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-700">
                      {m.confirmed}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-amber-700">
                      {m.unverified}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700">
                      {m.absent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Methodological Principle Notice (TZ Section 6 & 20) */}
      <div className="p-4 bg-white border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
        <div>
          <span className="font-semibold text-slate-900">Muhim metodologik qoida: </span>
          Excel faylida obyekt topilmagani uning kadastri yo‘qligini isbotlamaydi — bunday yozuvlar
          avval aniqlanmagan (sariq yoki kulrang) holatda saqlanib tekshiruvga yuboriladi. Sun’iy
          yo‘ldosh tasviri rasmiy yer chegarasi hujjati o‘rnini bosmaydi.
        </div>
      </div>

      {/* Recent Audit Logs for Admin */}
      {currentUser.role === 'admin' && data.recentLogs.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">So‘nggi tizim harakatlari (Audit)</h2>
            <button
              type="button"
              onClick={() => onNavigate('audit')}
              className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
            >
              Jurnalni ochish
            </button>
          </div>
          <div className="divide-y divide-slate-200 text-xs">
            {data.recentLogs.slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="px-5 py-2.5 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-slate-900">{log.actor_name}</span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="text-slate-700">{log.summary}</span>
                </div>
                <span className="font-mono text-[11px] text-slate-500 shrink-0">
                  {log.created_at}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {switchRoleModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {switchRoleModal === 'admin'
                    ? 'Admin bo‘limiga kirish'
                    : switchRoleModal === 'inspector'
                    ? 'Kadastr xodimi bo‘limiga kirish'
                    : 'Mahalla yettiligi bo‘limiga kirish'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tanlangan bo‘lim hisobi orqali tizimga kirishni tasdiqlang
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSwitchRoleModal(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {switchError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {switchError}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-600">
                Mavjud hisobni tanlash:
              </div>
              {ROLE_DEMO_ACCOUNTS.filter((a) => a.role === switchRoleModal).map((acc) => (
                <button
                  key={acc.username}
                  type="button"
                  onClick={() => {
                    setSwitchUsername(acc.username);
                    setSwitchPassword(acc.password);
                    setSwitchError(null);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 cursor-pointer ${
                    switchUsername === acc.username
                      ? 'border-blue-600 bg-blue-50/70'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-slate-900">{acc.label}</div>
                    <div className="text-[11px] text-slate-500">{acc.scope}</div>
                  </div>
                  <span className="font-mono text-[11px] text-blue-700">{acc.username}</span>
                </button>
              ))}
            </div>

            <form onSubmit={handleConfirmSwitch} className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Login
                  </label>
                  <input
                    type="text"
                    value={switchUsername}
                    onChange={(e) => setSwitchUsername(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Parol
                  </label>
                  <input
                    type="password"
                    value={switchPassword}
                    onChange={(e) => setSwitchPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSwitchRoleModal(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={switching}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{switching ? 'Kirilmoqda...' : 'Bo‘limga o‘tish'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
