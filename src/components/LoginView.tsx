import React, { useState } from 'react';
import { Building2, Eye, EyeOff, Lock, Map, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { apiRequest, setAuthToken } from '../api';
import type { AuthUser, UserRole } from '../types';

interface LoginViewProps {
  onLoginSuccess: (user: AuthUser) => void;
  initialRole?: UserRole;
}

interface RoleDemoAccount {
  role: UserRole;
  label: string;
  username: string;
  password: string;
  scope: string;
}

export const ROLE_DEMO_ACCOUNTS: RoleDemoAccount[] = [
  {
    role: 'admin',
    label: 'Viloyat boshqarmasi (Admin)',
    username: 'admin',
    password: 'Admin@2026!',
    scope: 'Andijon viloyati · To‘liq boshqaruv',
  },
  {
    role: 'inspector',
    label: 'Andijon shahri kadastr bo‘limi',
    username: 'kadastr_andijon',
    password: 'Kadastr@2026!',
    scope: 'Andijon shahri · Tekshiruv va tasdiqlash',
  },
  {
    role: 'inspector',
    label: 'Asaka tumani kadastr bo‘limi',
    username: 'kadastr_asaka',
    password: 'Kadastr@2026!',
    scope: 'Asaka tumani · Tekshiruv va tasdiqlash',
  },
  {
    role: 'mahalla',
    label: 'Yuqori MFY (Mahalla yettiligi)',
    username: '0212010',
    password: '0212010',
    scope: 'Faqat Yuqori MFY · Xaritada belgilash',
  },
  {
    role: 'mahalla',
    label: 'Boburshoh MFY (Mahalla yettiligi)',
    username: 'mahalla_boburshoh',
    password: 'Mahalla@2026!',
    scope: 'Faqat Boburshoh MFY · Xaritada belgilash',
  },
  {
    role: 'mahalla',
    label: 'Mustaqillik MFY (Mahalla yettiligi)',
    username: 'mahalla_mustaqillik',
    password: 'Mahalla@2026!',
    scope: 'Faqat Mustaqillik MFY · Xaritada belgilash',
  },
];

const ROLE_BUTTONS: {
  role: UserRole;
  title: string;
  subtitle: string;
  icon: typeof ShieldCheck;
}[] = [
  {
    role: 'admin',
    title: 'Admin',
    subtitle: 'Boshqaruv va nazorat',
    icon: ShieldCheck,
  },
  {
    role: 'inspector',
    title: 'Kadastr xodimi',
    subtitle: 'Tekshiruv va tasdiqlash',
    icon: Building2,
  },
  {
    role: 'mahalla',
    title: 'Mahalla yettiligi',
    subtitle: 'MFY hududi xatlovi',
    icon: Users,
  },
];

export function LoginView({ onLoginSuccess, initialRole = 'admin' }: LoginViewProps) {
  const defaultAccount =
    ROLE_DEMO_ACCOUNTS.find((a) => a.role === initialRole) || ROLE_DEMO_ACCOUNTS[0];

  const [selectedRole, setSelectedRole] = useState<UserRole>(initialRole);
  const [username, setUsername] = useState(defaultAccount.username);
  const [password, setPassword] = useState(defaultAccount.password);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectRole = (role: UserRole) => {
    setSelectedRole(role);
    const firstAcc = ROLE_DEMO_ACCOUNTS.find((a) => a.role === role);
    if (firstAcc) {
      setUsername(firstAcc.username);
      setPassword(firstAcc.password);
    }
    setError(null);
  };

  const applyDemoAccount = (acc: RoleDemoAccount) => {
    setSelectedRole(acc.role);
    setUsername(acc.username);
    setPassword(acc.password);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuthToken(res.token);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Tizimga kirishda xatolik yuz berdi.');
    } finally {
      setLoading(false);
    }
  };

  const filteredAccounts = ROLE_DEMO_ACCOUNTS.filter((a) => a.role === selectedRole);

  return (
    <div className="min-h-screen bg-slate-50 grid grid-cols-1 lg:grid-cols-12 items-stretch">
      {/* Left Institutional Information Panel */}
      <div className="lg:col-span-7 bg-slate-900 text-white p-8 lg:p-14 flex flex-col justify-between relative overflow-hidden">
        <div className="max-w-xl">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <Map className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">E-Kadastr Nazorat</span>
          </div>

          <h1
            className="text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight mb-5"
            style={{ textWrap: 'balance' }}
          >
            Uy-joylarning kadastr holatini elektron nazorat qilish axborot tizimi
          </h1>

          <p className="text-slate-300 text-base leading-relaxed mb-10">
            Hududlardagi turar-joy obyektlarini sun’iy yo‘ldosh xaritasi bilan bog‘lash, Excel
            reyestr ma’lumotlarini solishtirish, noaniq obyektlarni tekshiruvga yo‘naltirish va
            rasmiy holatni vakolatli tartibda qayd etish platformasi.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-8 border-t border-slate-800">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white mb-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Qat’iy hududiy vakolatlar</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Admin, Kadastr xodimi va Mahalla yettiligi faqat o‘ziga biriktirilgan tuman yoki
                mahalla ma’lumotlari bilan ishlaydi.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white mb-1.5">
                <UserCheck className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Ikki bosqichli holat nazorati</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Kadastr holati va tekshiruv jarayoni alohida yuritiladi; kadastr raqami yo‘qligi
                tekshiruvsiz qizil holatga o‘tkazilmaydi.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-10 mt-10 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <span>Tajriba-sinov hududi: Andijon viloyati</span>
          <span>Barcha amallar elektron audit jurnalida qayd etiladi</span>
        </div>
      </div>

      {/* Right Login Form Panel */}
      <div className="lg:col-span-5 bg-white p-8 lg:p-12 flex flex-col justify-center">
        <div className="w-full max-w-md mx-auto">
          <div className="mb-5">
            <h2 className="text-2xl font-bold text-slate-900 mb-1.5">Tizimga kirish</h2>
            <p className="text-sm text-slate-600">
              Kirish bo‘limini tanlang va biriktirilgan login hamda parolni kiriting:
            </p>
          </div>

          {/* 3 Primary Role Buttons: Admin | Kadastr xodimi | Mahalla yettiligi */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            {ROLE_BUTTONS.map((rb) => {
              const Icon = rb.icon;
              const active = selectedRole === rb.role;
              return (
                <button
                  key={rb.role}
                  type="button"
                  onClick={() => handleSelectRole(rb.role)}
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                    active
                      ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      active ? 'text-blue-400' : 'text-slate-500'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold leading-snug">{rb.title}</div>
                    <div
                      className={`text-[10px] mt-0.5 leading-tight ${
                        active ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {rb.subtitle}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 leading-relaxed">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Foydalanuvchi logini
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Login kiriting"
                autoComplete="username"
                required
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Parol</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="w-full px-3.5 py-2.5 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label="Parolni ko‘rsatish"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>
                {loading
                  ? 'Tekshirilmoqda...'
                  : `${ROLE_BUTTONS.find((r) => r.role === selectedRole)?.title} sifatida kirish`}
              </span>
            </button>
          </form>

          {/* Filtered Role Sub-accounts */}
          <div className="mt-6 pt-5 border-t border-slate-200">
            <div className="text-xs font-semibold text-slate-700 mb-2">
              Tanlangan bo‘lim bo‘yicha sinov hisoblari:
            </div>
            <div className="space-y-1.5">
              {filteredAccounts.map((acc) => {
                const isSelectedAcc = username === acc.username;
                return (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => applyDemoAccount(acc)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                      isSelectedAcc
                        ? 'border-blue-600 bg-blue-50/60'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {acc.label}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{acc.scope}</div>
                    </div>
                    <span className="font-mono text-[11px] text-blue-700 shrink-0">
                      {acc.username}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
