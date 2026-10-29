import React, { useEffect, useMemo, useState } from 'react';
import { Lock, MapPin, Plus, Unlock, UserPlus, X } from 'lucide-react';
import { apiRequest } from '../api';
import {
  USER_ROLE_LABELS,
  type AuthUser,
  type RegionItem,
  type UserRole,
} from '../types';

interface UsersRegionsViewProps {
  currentUser: AuthUser;
  regions: RegionItem[];
  onRegionsChanged: () => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

export function UsersRegionsView({
  currentUser,
  regions,
  onRegionsChanged,
  onToast,
}: UsersRegionsViewProps) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<'users' | 'regions'>('users');

  // Create User Modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('inspector');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [tumanId, setTumanId] = useState('');
  const [mahallaId, setMahallaId] = useState('');
  const [savingUser, setSavingUser] = useState(false);

  // Create Region Modal
  const [showRegionModal, setShowRegionModal] = useState(false);
  const [regLevel, setRegLevel] = useState<'tuman' | 'mahalla'>('mahalla');
  const [regParentId, setRegParentId] = useState('');
  const [regName, setRegName] = useState('');
  const [regCode, setRegCode] = useState('');
  const [regLat, setRegLat] = useState('40.7834');
  const [regLng, setRegLng] = useState('72.3455');
  const [savingRegion, setSavingRegion] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<AuthUser[]>('/api/users');
      setUsers(res);
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const viloyatList = useMemo(() => regions.filter((r) => r.level === 'viloyat'), [regions]);
  const tumanList = useMemo(() => regions.filter((r) => r.level === 'tuman'), [regions]);
  const mahallaList = useMemo(
    () =>
      regions.filter(
        (r) => r.level === 'mahalla' && (!tumanId || r.parent_id === Number(tumanId))
      ),
    [regions, tumanId]
  );

  const handleToggleBlock = async (u: AuthUser) => {
    try {
      await apiRequest(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_blocked: u.is_blocked ? 0 : 1 }),
      });
      onToast(
        u.is_blocked
          ? `"${u.username}" hisobi faollashtirildi.`
          : `"${u.username}" hisobi bloklandi va faol sessiyasi bekor qilindi.`,
        'success'
      );
      loadUsers();
    } catch (err: any) {
      onToast(err.message, 'error');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUser(true);
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          full_name: fullName,
          role,
          phone: phone || null,
          position: position || null,
          viloyat_id: viloyatList[0]?.id ?? 1,
          tuman_id: role === 'admin' ? null : Number(tumanId),
          mahalla_id: role === 'mahalla' ? Number(mahallaId) : null,
        }),
      });
      onToast(`Yangi foydalanuvchi (${username}) yaratildi.`, 'success');
      setShowUserModal(false);
      setUsername('');
      setPassword('');
      setFullName('');
      setPhone('');
      setPosition('');
      loadUsers();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setSavingUser(false);
    }
  };

  const handleCreateRegion = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRegion(true);
    try {
      await apiRequest('/api/regions', {
        method: 'POST',
        body: JSON.stringify({
          name: regName,
          level: regLevel,
          parent_id:
            regLevel === 'tuman'
              ? viloyatList[0]?.id ?? 1
              : Number(regParentId || tumanList[0]?.id),
          code: regCode,
          center_lat: Number(regLat),
          center_lng: Number(regLng),
          default_zoom: regLevel === 'mahalla' ? 17 : 14,
        }),
      });
      onToast(`"${regName}" hududi tizimga qo‘shildi.`, 'success');
      setShowRegionModal(false);
      setRegName('');
      setRegCode('');
      onRegionsChanged();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setSavingRegion(false);
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-[1440px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Foydalanuvchilar va hududiy vakolatlar boshqaruvi
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Foydalanuvchilarni yaratish, bloklash, parollarni xeshlash va tuman/mahalla
            chegaralariga biriktirish
          </p>
        </div>

        <div className="flex items-center gap-2">
          {subTab === 'users' ? (
            <button
              type="button"
              onClick={() => {
                const defT = tumanList[0] ? String(tumanList[0].id) : '';
                setTumanId(defT);
                const defM = regions.find(
                  (r) => r.level === 'mahalla' && r.parent_id === Number(defT)
                );
                setMahallaId(defM ? String(defM.id) : '');
                setShowUserModal(true);
              }}
              className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Yangi foydalanuvchi yaratish</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setRegParentId(tumanList[0] ? String(tumanList[0].id) : '');
                setShowRegionModal(true);
              }}
              className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tuman yoki mahalla qo‘shish</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setSubTab('users')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            subTab === 'users'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Foydalanuvchilar ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('regions')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
            subTab === 'regions'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Viloyat, tuman va mahallalar ({regions.length})
        </button>
      </div>

      {subTab === 'users' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-6 text-xs text-slate-500">Yuklanmoqda...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-4">F.I.Sh va Lavozim</th>
                    <th className="py-2.5 px-3">Login</th>
                    <th className="py-2.5 px-3">Rol</th>
                    <th className="py-2.5 px-3">Biriktirilgan hudud</th>
                    <th className="py-2.5 px-3">Holati</th>
                    <th className="py-2.5 px-3">Oxirgi kirish</th>
                    <th className="py-2.5 px-4 text-right">Boshqaruv</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{u.full_name}</div>
                        <div className="text-[11px] text-slate-500">
                          {u.position || '—'} {u.phone ? `· ${u.phone}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-900">{u.username}</td>
                      <td className="py-3 px-3 font-medium text-slate-800">
                        {USER_ROLE_LABELS[u.role]}
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {u.mahalla_name
                          ? `${u.tuman_name} · ${u.mahalla_name}`
                          : u.tuman_name
                          ? `${u.viloyat_name} · ${u.tuman_name}`
                          : u.viloyat_name || 'Barcha hududlar'}
                      </td>
                      <td className="py-3 px-3">
                        {u.is_blocked ? (
                          <span className="text-red-700 font-semibold">Bloklangan</span>
                        ) : (
                          <span className="text-emerald-700 font-medium">Faol</span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-500">
                        {u.last_login_at || 'Hali kirmagan'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {u.id !== currentUser.id && (
                          <button
                            type="button"
                            onClick={() => handleToggleBlock(u)}
                            className={`px-2.5 py-1 text-xs font-medium rounded border inline-flex items-center gap-1 cursor-pointer ${
                              u.is_blocked
                                ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                                : 'border-red-300 text-red-700 hover:bg-red-50'
                            }`}
                          >
                            {u.is_blocked ? (
                              <>
                                <Unlock className="w-3 h-3" />
                                <span>Ochish</span>
                              </>
                            ) : (
                              <>
                                <Lock className="w-3 h-3" />
                                <span>Bloklash</span>
                              </>
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Kod</th>
                  <th className="py-2.5 px-3">Hudud nomi</th>
                  <th className="py-2.5 px-3">Darajasi</th>
                  <th className="py-2.5 px-3">Markaz koordinatalari</th>
                  <th className="py-2.5 px-4 text-right">Masshtab (Zoom)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {regions.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{r.code}</td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{r.name}</td>
                    <td className="py-2.5 px-3 text-slate-600 capitalize">{r.level}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-700">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {r.center_lat.toFixed(4)}, {r.center_lng.toFixed(4)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                      {r.default_zoom}x
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Yangi foydalanuvchi qo‘shish</h2>
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">F.I.Sh</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder="Masalan: Xolmatov Bekzod Rustamovich"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Login</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="kadastr_shahrixon"
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Parol (kamida 8 belgi)
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Rol</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="inspector">Kadastr xodimi</option>
                    <option value="mahalla">Mahalla vakili</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Telefon</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+998 90 ..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Lavozimi</label>
                <input
                  type="text"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="Masalan: Tuman kadastr muhandisi"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              {role !== 'admin' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Biriktirilgan tuman
                    </label>
                    <select
                      value={tumanId}
                      onChange={(e) => {
                        setTumanId(e.target.value);
                        const m = regions.find(
                          (r) => r.level === 'mahalla' && r.parent_id === Number(e.target.value)
                        );
                        setMahallaId(m ? String(m.id) : '');
                      }}
                      required
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      {tumanList.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {role === 'mahalla' && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Biriktirilgan mahalla
                      </label>
                      <select
                        value={mahallaId}
                        onChange={(e) => setMahallaId(e.target.value)}
                        required
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                      >
                        {mahallaList.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg cursor-pointer"
                >
                  {savingUser ? 'Saqlanmoqda...' : 'Yaratish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Region Modal */}
      {showRegionModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Yangi hudud kiritish</h2>
              <button
                type="button"
                onClick={() => setShowRegionModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRegion} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hudud darajasi</label>
                <select
                  value={regLevel}
                  onChange={(e) => setRegLevel(e.target.value as 'tuman' | 'mahalla')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="mahalla">Mahalla (MFY)</option>
                  <option value="tuman">Tuman / Shahar</option>
                </select>
              </div>

              {regLevel === 'mahalla' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tegishli tuman</label>
                  <select
                    value={regParentId}
                    onChange={(e) => setRegParentId(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {tumanList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Hudud nomi</label>
                  <input
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    required
                    placeholder="Masalan: Bog‘ishamol MFY"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Yagona kodi</label>
                  <input
                    type="text"
                    value={regCode}
                    onChange={(e) => setRegCode(e.target.value)}
                    required
                    placeholder="AND-BOG"
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Markaz Latitude</label>
                  <input
                    type="text"
                    value={regLat}
                    onChange={(e) => setRegLat(e.target.value)}
                    required
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Markaz Longitude</label>
                  <input
                    type="text"
                    value={regLng}
                    onChange={(e) => setRegLng(e.target.value)}
                    required
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRegionModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={savingRegion}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg cursor-pointer"
                >
                  {savingRegion ? 'Saqlanmoqda...' : 'Qo‘shish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
