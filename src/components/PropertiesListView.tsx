import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { apiRequest } from '../api';
import {
  CADASTRAL_STATUS_LABELS,
  INSPECTION_STATUS_LABELS,
  type AuthUser,
  type ObjectType,
  type PropertyRecord,
  type RegionItem,
} from '../types';
import {
  CadastralStatusText,
  InspectionStatusText,
  MarkerCategoryText,
} from './StatusIndicator';

interface PropertiesListViewProps {
  currentUser: AuthUser;
  regions: RegionItem[];
  initialSearchUid: string;
  onClearInitialSearch: () => void;
  onOpenPropertyCard: (propertyId: number) => void;
  onFlyToMap: (propertyId: number, lat: number | null, lng: number | null, fixMode?: boolean) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

export function PropertiesListView({
  currentUser,
  regions,
  initialSearchUid,
  onClearInitialSearch,
  onOpenPropertyCard,
  onFlyToMap,
  onToast,
}: PropertiesListViewProps) {
  const [items, setItems] = useState<PropertyRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState(initialSearchUid || '');
  const [tumanId, setTumanId] = useState(
    currentUser.tuman_id ? String(currentUser.tuman_id) : ''
  );
  const [mahallaId, setMahallaId] = useState(
    currentUser.mahalla_id ? String(currentUser.mahalla_id) : ''
  );
  const [cadastralStatus, setCadastralStatus] = useState('');
  const [inspectionStatus, setInspectionStatus] = useState('');
  const [markerColor, setMarkerColor] = useState('');

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formTuman, setFormTuman] = useState(
    currentUser.tuman_id ? String(currentUser.tuman_id) : ''
  );
  const [formMahalla, setFormMahalla] = useState(
    currentUser.mahalla_id ? String(currentUser.mahalla_id) : ''
  );
  const [formAddress, setFormAddress] = useState('');
  const [formAddressCode, setFormAddressCode] = useState('');
  const [formParcelCode, setFormParcelCode] = useState('');
  const [formObjType, setFormObjType] = useState<ObjectType>('residential_house');
  const [formLat, setFormLat] = useState('');
  const [formLng, setFormLng] = useState('');
  const [formCadNum, setFormCadNum] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialSearchUid) {
      setQ(initialSearchUid);
      setPage(1);
      onClearInitialSearch();
    }
  }, [initialSearchUid, onClearInitialSearch]);

  const tumanList = useMemo(() => regions.filter((r) => r.level === 'tuman'), [regions]);
  const mahallaList = useMemo(
    () =>
      regions.filter(
        (r) => r.level === 'mahalla' && (!tumanId || r.parent_id === Number(tumanId))
      ),
    [regions, tumanId]
  );

  const modalMahallaList = useMemo(
    () =>
      regions.filter(
        (r) => r.level === 'mahalla' && (!formTuman || r.parent_id === Number(formTuman))
      ),
    [regions, formTuman]
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: '12',
      });
      if (q.trim()) qs.set('q', q.trim());
      if (tumanId) qs.set('tumanId', tumanId);
      if (mahallaId) qs.set('mahallaId', mahallaId);
      if (cadastralStatus) qs.set('cadastralStatus', cadastralStatus);
      if (inspectionStatus) qs.set('inspectionStatus', inspectionStatus);
      if (markerColor) qs.set('markerColor', markerColor);

      const res = await apiRequest<{
        items: PropertyRecord[];
        total: number;
        page: number;
        totalPages: number;
      }>(`/api/properties?${qs.toString()}`);

      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [page, q, tumanId, mahallaId, cadastralStatus, inspectionStatus, markerColor, onToast]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadList();
    }, 150);
    return () => clearTimeout(t);
  }, [loadList]);

  const openCreateDialog = () => {
    const defTuman = currentUser.tuman_id
      ? String(currentUser.tuman_id)
      : tumanList[0]
      ? String(tumanList[0].id)
      : '';
    setFormTuman(defTuman);
    if (currentUser.mahalla_id) {
      setFormMahalla(String(currentUser.mahalla_id));
    } else {
      const firstM = regions.find(
        (r) => r.level === 'mahalla' && (!defTuman || r.parent_id === Number(defTuman))
      );
      setFormMahalla(firstM ? String(firstM.id) : '');
    }
    setShowCreateModal(true);
  };

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const created = await apiRequest<PropertyRecord>('/api/properties', {
        method: 'POST',
        body: JSON.stringify({
          tuman_id: Number(formTuman),
          mahalla_id: Number(formMahalla),
          address: formAddress,
          address_code: formAddressCode || null,
          parent_parcel_code: formParcelCode || null,
          object_type: formObjType,
          latitude: formLat ? Number(formLat) : null,
          longitude: formLng ? Number(formLng) : null,
          cadastral_number: formCadNum || null,
          notes: formNotes || null,
          request_inspection: true,
        }),
      });
      onToast(`Yangi obyekt (${created.system_uid}) muvaffaqiyatli kiritildi.`, 'success');
      setShowCreateModal(false);
      setFormAddress('');
      setFormAddressCode('');
      setFormParcelCode('');
      setFormLat('');
      setFormLng('');
      setFormCadNum('');
      setFormNotes('');
      loadList();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-[1440px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Uy-joy obyektlari reyestri</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Qidiruv va filtrlash server tomonida bajariladi · Topilgan noyob yozuvlar:{' '}
            <span className="font-mono font-semibold text-slate-900">{total}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateDialog}
          className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Obyekt qo‘shish</span>
        </button>
      </div>

      {/* Server-side Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
        <div className="lg:col-span-2 relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Yagona ID, manzil yoki kadastr raqami..."
            className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <select
          value={tumanId}
          disabled={Boolean(currentUser.tuman_id)}
          onChange={(e) => {
            setTumanId(e.target.value);
            setMahallaId('');
            setPage(1);
          }}
          className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
        >
          {!currentUser.tuman_id && <option value="">Barcha tumanlar</option>}
          {tumanList.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select
          value={mahallaId}
          disabled={Boolean(currentUser.mahalla_id)}
          onChange={(e) => {
            setMahallaId(e.target.value);
            setPage(1);
          }}
          className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
        >
          {!currentUser.mahalla_id && <option value="">Barcha mahallalar</option>}
          {mahallaList.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <select
          value={cadastralStatus}
          onChange={(e) => {
            setCadastralStatus(e.target.value);
            setPage(1);
          }}
          className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
        >
          <option value="">Kadastr holati (barchasi)</option>
          {Object.entries(CADASTRAL_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <select
          value={inspectionStatus}
          onChange={(e) => {
            setInspectionStatus(e.target.value);
            setPage(1);
          }}
          className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
        >
          <option value="">Tekshiruv holati (barchasi)</option>
          {Object.entries(INSPECTION_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {/* Secondary Marker Color Quick Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {[
            { id: '', label: 'Barcha ranglar' },
            { id: 'green', label: 'Yashil (Tasdiqlangan)' },
            { id: 'yellow', label: 'Sariq (Tekshiruv talab)' },
            { id: 'red', label: 'Qizil (Yo‘qligi tasdiqlangan)' },
            { id: 'gray', label: 'Kulrang (Joylashuvsiz)' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMarkerColor(tab.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                markerColor === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(q || cadastralStatus || inspectionStatus || markerColor) && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              setCadastralStatus('');
              setInspectionStatus('');
              setMarkerColor('');
              if (!currentUser.tuman_id) setTumanId('');
              if (!currentUser.mahalla_id) setMahallaId('');
              setPage(1);
            }}
            className="text-xs text-slate-600 hover:text-slate-900 underline cursor-pointer"
          >
            Filtrlarni tozalash
          </button>
        )}
      </div>

      {/* High-Density Data Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-2.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-sm font-semibold text-slate-800">
              Tanlangan mezonlar bo‘yicha obyektlar topilmadi
            </div>
            <p className="text-xs text-slate-500">
              Filtrlarni o‘zgartiring yoki yangi uy-joy obyektini kiriting.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Yagona ID</th>
                  <th className="py-2.5 px-3">Hudud va Manzil</th>
                  <th className="py-2.5 px-3">Kadastr raqami</th>
                  <th className="py-2.5 px-3">Kadastr holati</th>
                  <th className="py-2.5 px-3">Tekshiruv holati</th>
                  <th className="py-2.5 px-3">Xarita belgisi</th>
                  <th className="py-2.5 px-4 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {items.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {p.system_uid}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-900">{p.address}</div>
                      <div className="text-[11px] text-slate-500">
                        {p.tuman_name} · {p.mahalla_name}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-800 whitespace-nowrap">
                      {p.cadastral_number || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="py-3 px-3">
                      <CadastralStatusText status={p.cadastral_status} />
                    </td>
                    <td className="py-3 px-3">
                      <InspectionStatusText status={p.inspection_status} />
                    </td>
                    <td className="py-3 px-3">
                      <MarkerCategoryText color={p.marker_color} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          onFlyToMap(
                            p.id,
                            p.latitude,
                            p.longitude,
                            p.latitude === null || p.longitude === null
                          )
                        }
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{p.latitude !== null ? 'Xarita' : 'Belgilash'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenPropertyCard(p.id)}
                        className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                      >
                        Obyekt kartasi
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <div>
            Sahifa <span className="font-mono font-semibold text-slate-900">{page}</span> /{' '}
            <span className="font-mono font-semibold text-slate-900">{totalPages}</span> · Jami:{' '}
            <span className="font-mono font-semibold text-slate-900">{total}</span> ta obyekt
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1.5 border border-slate-300 bg-white rounded-md disabled:opacity-40 hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Oldingi</span>
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1.5 border border-slate-300 bg-white rounded-md disabled:opacity-40 hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Keyingi</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Add Property Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Yangi uy-joy obyektini kiritish</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProperty} className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tuman / Shahar</label>
                  <select
                    value={formTuman}
                    disabled={Boolean(currentUser.tuman_id)}
                    onChange={(e) => {
                      setFormTuman(e.target.value);
                      const firstM = regions.find(
                        (r) => r.level === 'mahalla' && r.parent_id === Number(e.target.value)
                      );
                      setFormMahalla(firstM ? String(firstM.id) : '');
                    }}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    {tumanList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mahalla (MFY)</label>
                  <select
                    value={formMahalla}
                    disabled={Boolean(currentUser.mahalla_id)}
                    onChange={(e) => setFormMahalla(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    {modalMahallaList.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">To‘liq manzil</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  required
                  placeholder="Masalan: Boburshoh shoh ko‘chasi, 64-uy"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Obyekt turi</label>
                  <select
                    value={formObjType}
                    onChange={(e) => setFormObjType(e.target.value as ObjectType)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="residential_house">Uy-joy binosi</option>
                    <option value="auxiliary_building">Qo‘shimcha bino</option>
                    <option value="land_parcel">Yer uchastkasi</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Manzil kodi</label>
                  <input
                    type="text"
                    value={formAddressCode}
                    onChange={(e) => setFormAddressCode(e.target.value)}
                    placeholder="UZ-1703-..."
                    className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Uchastka kodi</label>
                  <input
                    type="text"
                    value={formParcelCode}
                    onChange={(e) => setFormParcelCode(e.target.value)}
                    placeholder="PARCEL-..."
                    className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kenglik (Latitude)
                  </label>
                  <input
                    type="text"
                    value={formLat}
                    onChange={(e) => setFormLat(e.target.value)}
                    placeholder="40.7834"
                    className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Uzunlik (Longitude)
                  </label>
                  <input
                    type="text"
                    value={formLng}
                    onChange={(e) => setFormLng(e.target.value)}
                    placeholder="72.3455"
                    className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kadastr raqami</label>
                  <input
                    type="text"
                    value={formCadNum}
                    onChange={(e) => setFormCadNum(e.target.value)}
                    placeholder="17:03:..."
                    className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Izoh</label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Qo‘shimcha ma’lumot yoki tekshiruv sababi..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg cursor-pointer"
                >
                  {submitting ? 'Saqlanmoqda...' : 'Saqlash va tekshiruvga yuborish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
