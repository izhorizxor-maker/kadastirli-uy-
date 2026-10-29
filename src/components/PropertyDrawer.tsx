import React, { useEffect, useState } from 'react';
import {
  Check,
  Download,
  ExternalLink,
  FileText,
  History,
  MapPin,
  Paperclip,
  Send,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { apiRequest } from '../api';
import {
  OBJECT_TYPE_LABELS,
  type AttachmentItem,
  type AuditLogItem,
  type AuthUser,
  type CadastralRecordItem,
  type CadastralStatus,
  type InspectionItem,
  type PropertyRecord,
  type TaskItem,
} from '../types';
import {
  CadastralStatusText,
  InspectionStatusText,
  MarkerCategoryText,
} from './StatusIndicator';

interface PropertyDrawerProps {
  propertyId: number | null;
  currentUser: AuthUser;
  onClose: () => void;
  onUpdated: () => void;
  onJumpToMap: (prop: PropertyRecord, startCorrectionMode?: boolean) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

interface PropertyFullPayload {
  property: PropertyRecord;
  cadastralRecords: CadastralRecordItem[];
  inspections: InspectionItem[];
  tasks: TaskItem[];
  attachments: AttachmentItem[];
  history: AuditLogItem[];
}

export function PropertyDrawer({
  propertyId,
  currentUser,
  onClose,
  onUpdated,
  onJumpToMap,
  onToast,
}: PropertyDrawerProps) {
  const [data, setData] = useState<PropertyFullPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'confirm' | 'docs' | 'history'>('details');

  // Editable metadata & technical passport fields
  const [address, setAddress] = useState('');
  const [addressCode, setAddressCode] = useState('');
  const [builtYear, setBuiltYear] = useState('');
  const [floorsCount, setFloorsCount] = useState('');
  const [roomsCount, setRoomsCount] = useState('');
  const [landAreaM2, setLandAreaM2] = useState('');
  const [buildingAreaM2, setBuildingAreaM2] = useState('');
  const [wallMaterial, setWallMaterial] = useState('');
  const [utilitiesInfo, setUtilitiesInfo] = useState('');
  const [registrationDate, setRegistrationDate] = useState('');
  const [notes, setNotes] = useState('');
  const [dirtyEdit, setDirtyEdit] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  // Official confirmation form (Admin / Inspector)
  const [officialStatus, setOfficialStatus] = useState<CadastralStatus>('confirmed');
  const [officialCadNum, setOfficialCadNum] = useState('');
  const [authoritySource, setAuthoritySource] = useState(
    'Kadastr agentligi Yagona integratsiyalashgan axborot tizimi'
  );
  const [officialComment, setOfficialComment] = useState('');
  const [savingOfficial, setSavingOfficial] = useState(false);

  // Task request form (Mahalla / Staff)
  const [taskReason, setTaskReason] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);

  // Attachment form
  const [docTitle, setDocTitle] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    mime: string;
    size: number;
    dataUrl: string;
  } | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const loadDetails = async (id: number) => {
    setLoading(true);
    try {
      const res = await apiRequest<PropertyFullPayload>(`/api/properties/${id}`);
      setData(res);
      setAddress(res.property.address);
      setAddressCode(res.property.address_code ?? '');
      setBuiltYear(res.property.built_year !== null && res.property.built_year !== undefined ? String(res.property.built_year) : '');
      setFloorsCount(res.property.floors_count !== null && res.property.floors_count !== undefined ? String(res.property.floors_count) : '');
      setRoomsCount(res.property.rooms_count !== null && res.property.rooms_count !== undefined ? String(res.property.rooms_count) : '');
      setLandAreaM2(res.property.land_area_m2 !== null && res.property.land_area_m2 !== undefined ? String(res.property.land_area_m2) : '');
      setBuildingAreaM2(res.property.building_area_m2 !== null && res.property.building_area_m2 !== undefined ? String(res.property.building_area_m2) : '');
      setWallMaterial(res.property.wall_material ?? '');
      setUtilitiesInfo(res.property.utilities_info ?? '');
      setRegistrationDate(res.property.registration_date ?? '');
      setNotes(res.property.notes ?? '');
      setOfficialStatus(
        res.property.cadastral_status === 'unverified' ? 'confirmed' : res.property.cadastral_status
      );
      setOfficialCadNum(res.property.cadastral_number ?? '');
      setDirtyEdit(false);
      setConfirmDiscard(false);
    } catch (err: any) {
      onToast(err.message || 'Obyekt kartasini yuklashda xatolik.', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (propertyId !== null) {
      setActiveTab('details');
      loadDetails(propertyId);
    } else {
      setData(null);
    }
  }, [propertyId]);

  // Warn before browser refresh if unsaved edits exist (TZ Section 15)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyEdit) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyEdit]);

  if (propertyId === null) return null;

  const requestClose = () => {
    if (dirtyEdit && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setDirtyEdit(false);
    setConfirmDiscard(false);
    onClose();
  };

  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;
    setSavingMeta(true);
    try {
      await apiRequest(`/api/properties/${data.property.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          address,
          address_code: addressCode || null,
          built_year: builtYear ? Number(builtYear) : null,
          floors_count: floorsCount ? Number(floorsCount) : null,
          rooms_count: roomsCount ? Number(roomsCount) : null,
          land_area_m2: landAreaM2 ? Number(landAreaM2) : null,
          building_area_m2: buildingAreaM2 ? Number(buildingAreaM2) : null,
          wall_material: wallMaterial || null,
          utilities_info: utilitiesInfo || null,
          registration_date: registrationDate || null,
          notes: notes || null,
        }),
      });
      onToast('Uy-joy va texnik pasport ma’lumotlari saqlandi.', 'success');
      setDirtyEdit(false);
      await loadDetails(data.property.id);
      onUpdated();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setSavingMeta(false);
    }
  };

  const handleConfirmCadastre = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;
    setSavingOfficial(true);
    try {
      await apiRequest(`/api/properties/${data.property.id}/confirm-cadastre`, {
        method: 'POST',
        body: JSON.stringify({
          cadastral_status: officialStatus,
          cadastral_number: officialCadNum || null,
          authority_source: authoritySource,
          comment: officialComment,
        }),
      });
      onToast('Rasmiy kadastr holati tasdiqlandi va tarixda qayd etildi.', 'success');
      setOfficialComment('');
      await loadDetails(data.property.id);
      onUpdated();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setSavingOfficial(false);
    }
  };

  const handleResolveLocation = async (approve: boolean) => {
    if (!data) return;
    try {
      await apiRequest(`/api/properties/${data.property.id}/location/resolve`, {
        method: 'POST',
        body: JSON.stringify({ approve }),
      });
      onToast(
        approve ? 'Yangi koordinatalar tasdiqlandi.' : 'Joylashuv so‘rovi rad etildi.',
        'success'
      );
      await loadDetails(data.property.id);
      onUpdated();
    } catch (err: any) {
      onToast(err.message, 'error');
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || !taskReason.trim()) return;
    setCreatingTask(true);
    try {
      await apiRequest('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          property_id: data.property.id,
          reason: taskReason.trim(),
        }),
      });
      onToast('Tekshiruv topshirig‘i mas’ul xodimga yuborildi.', 'success');
      setTaskReason('');
      await loadDetails(data.property.id);
      onUpdated();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setCreatingTask(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      onToast('Fayl hajmi 2.5 MB dan oshmasligi kerak.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedFile({
        name: file.name,
        mime: file.type || 'application/pdf',
        size: file.size,
        dataUrl: String(reader.result || ''),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleUploadAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data || !selectedFile || !docTitle.trim()) return;
    setUploadingDoc(true);
    try {
      await apiRequest(`/api/properties/${data.property.id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          doc_title: docTitle.trim(),
          doc_number: docNumber.trim() || null,
          file_name: selectedFile.name,
          mime_type: selectedFile.mime,
          file_size: selectedFile.size,
          data_url: selectedFile.dataUrl,
        }),
      });
      onToast('Hujjat muvaffaqiyatli biriktirildi.', 'success');
      setDocTitle('');
      setDocNumber('');
      setSelectedFile(null);
      await loadDetails(data.property.id);
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setUploadingDoc(false);
    }
  };

  const prop = data?.property;
  const canConfirmOfficial = currentUser.role === 'admin' || currentUser.role === 'inspector';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div className="w-full max-w-2xl bg-white h-full flex flex-col border-l border-slate-200 shadow-xl overflow-hidden">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-0.5">
              <span className="font-mono font-semibold text-slate-900">
                {prop?.system_uid || 'Yuklanmoqda...'}
              </span>
              {prop && (
                <>
                  <span>·</span>
                  <span className="truncate">
                    {prop.tuman_name} / {prop.mahalla_name}
                  </span>
                </>
              )}
            </div>
            <h2 className="text-base font-bold text-slate-900 truncate">
              {prop?.address || 'Obyekt kartasi'}
            </h2>
          </div>

          <button
            type="button"
            onClick={requestClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Yopish"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Unsaved Changes Warning Banner */}
        {confirmDiscard && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-4 shrink-0">
            <span className="text-xs text-amber-900 font-medium">
              Saqlanmagan o‘zgarishlar mavjud. Saqlamasdan yopishni tasdiqlaysizmi?
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="px-2.5 py-1 text-xs font-medium bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Tahrirlashda qolish
              </button>
              <button
                type="button"
                onClick={() => {
                  setDirtyEdit(false);
                  setConfirmDiscard(false);
                  onClose();
                }}
                className="px-2.5 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer"
              >
                Saqlamasdan yopish
              </button>
            </div>
          </div>
        )}

        {/* Drawer Tabs */}
        <div className="px-6 pt-2 border-b border-slate-200 flex items-center gap-1 bg-slate-50 shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'details'
                ? 'border-slate-900 text-slate-900 bg-white rounded-t-md'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Obyekt ma’lumotlari
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('confirm')}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'confirm'
                ? 'border-slate-900 text-slate-900 bg-white rounded-t-md'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Rasmiy kadastr holati</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('docs')}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'docs'
                ? 'border-slate-900 text-slate-900 bg-white rounded-t-md'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Paperclip className="w-3.5 h-3.5" />
            <span>Hujjatlar ({data?.attachments.length ?? 0})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'border-slate-900 text-slate-900 bg-white rounded-t-md'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Tarix ({data?.history.length ?? 0})</span>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading || !prop ? (
            <div className="space-y-4">
              <div className="h-20 bg-slate-100 rounded-lg animate-pulse" />
              <div className="h-44 bg-slate-100 rounded-lg animate-pulse" />
              <div className="h-32 bg-slate-100 rounded-lg animate-pulse" />
            </div>
          ) : activeTab === 'details' ? (
            <>
              {/* Dual Status Summary Strip */}
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">Xarita belgisi</div>
                  <MarkerCategoryText color={prop.marker_color} />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">A. Kadastr holati</div>
                  <CadastralStatusText status={prop.cadastral_status} />
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">B. Tekshiruv holati</div>
                  <InspectionStatusText status={prop.inspection_status} />
                </div>
              </div>

              {/* Pending Location Fix Banner */}
              {prop.pending_lat !== null && prop.pending_lng !== null && (
                <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 space-y-2.5">
                  <div className="text-xs font-semibold text-amber-950">
                    Joylashuvni tuzatish bo‘yicha tasdiqlanmagan so‘rov mavjud
                  </div>
                  <div className="text-xs text-amber-900">
                    Taklif etilgan koordinata:{' '}
                    <span className="font-mono font-semibold">
                      {prop.pending_lat}, {prop.pending_lng}
                    </span>
                    {prop.pending_location_by_name && ` (${prop.pending_location_by_name})`}
                  </div>
                  {prop.pending_location_note && (
                    <div className="text-xs text-amber-800">{prop.pending_location_note}</div>
                  )}
                  {canConfirmOfficial && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleResolveLocation(true)}
                        className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Koordinatani tasdiqlash</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveLocation(false)}
                        className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md cursor-pointer"
                      >
                        Rad etish
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Core Read-Only Cadastral Attributes Grid */}
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-xs">
                <div className="grid grid-cols-3 px-4 py-2.5">
                  <span className="text-slate-500">Yagona identifikator</span>
                  <span className="col-span-2 font-mono font-semibold text-slate-900">
                    {prop.system_uid}
                  </span>
                </div>
                <div className="grid grid-cols-3 px-4 py-2.5">
                  <span className="text-slate-500">Hudud</span>
                  <span className="col-span-2 text-slate-900">
                    {prop.viloyat_name} · {prop.tuman_name} · {prop.mahalla_name}
                  </span>
                </div>
                <div className="grid grid-cols-3 px-4 py-2.5">
                  <span className="text-slate-500">Obyekt turi</span>
                  <span className="col-span-2 text-slate-900">
                    {OBJECT_TYPE_LABELS[prop.object_type] || prop.object_type}
                    {prop.parent_parcel_code ? ` (Uchastka: ${prop.parent_parcel_code})` : ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 px-4 py-2.5">
                  <span className="text-slate-500">Kadastr raqami</span>
                  <span className="col-span-2 font-mono text-slate-900">
                    {prop.cadastral_number || 'Kiritilmagan (aniqlanmagan)'}
                  </span>
                </div>
                <div className="grid grid-cols-3 px-4 py-2.5 items-center">
                  <span className="text-slate-500">Koordinatalar</span>
                  <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-slate-900">
                      {prop.latitude !== null && prop.longitude !== null
                        ? `${prop.latitude.toFixed(6)}, ${prop.longitude.toFixed(6)}`
                        : 'Joylashuvi aniqlanmagan'}
                    </span>
                    <div className="flex items-center gap-2">
                      {prop.latitude !== null && prop.longitude !== null && (
                        <button
                          type="button"
                          onClick={() => onJumpToMap(prop, false)}
                          className="text-blue-700 hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Xaritada ko‘rish</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onJumpToMap(prop, true)}
                        className="text-slate-700 hover:text-slate-900 underline font-medium inline-flex items-center gap-1 cursor-pointer"
                      >
                        <MapPin className="w-3 h-3" />
                        <span>
                          {prop.latitude !== null ? 'Joylashuvni tuzatish' : 'Xaritada belgilash'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 px-4 py-2.5">
                  <span className="text-slate-500">Ma’lumot manbasi</span>
                  <span className="col-span-2 text-slate-900">
                    {prop.source}
                    {prop.source_date ? ` (${prop.source_date})` : ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 px-4 py-2.5">
                  <span className="text-slate-500">Mas’ul xodim</span>
                  <span className="col-span-2 text-slate-900">
                    {prop.assigned_user_name || 'Biriktirilmagan'}
                  </span>
                </div>
                <div className="grid grid-cols-3 px-4 py-2.5">
                  <span className="text-slate-500">Oxirgi tekshiruv</span>
                  <span className="col-span-2 font-mono text-slate-900">
                    {prop.last_inspected_at || 'Hali tekshirilmagan'}
                  </span>
                </div>
              </div>

              {/* Technical Building Passport Summary */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-900">
                  Uy-joyning texnik pasport ko‘rsatkichlari
                </h3>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-xs">
                  <div className="grid grid-cols-3 px-4 py-2.5">
                    <span className="text-slate-500">Qurilgan yili</span>
                    <span className="col-span-2 font-mono font-semibold text-slate-900 tabular-nums">
                      {prop.built_year ? `${prop.built_year}-yil` : 'Kiritilmagan'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 px-4 py-2.5">
                    <span className="text-slate-500">Qavatlar va xonalar</span>
                    <span className="col-span-2 font-mono text-slate-900 tabular-nums">
                      {prop.floors_count ? `${prop.floors_count} qavat` : '—'}
                      {' · '}
                      {prop.rooms_count ? `${prop.rooms_count} xona` : 'xonalar kiritilmagan'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 px-4 py-2.5">
                    <span className="text-slate-500">Umumiy yer maydoni</span>
                    <span className="col-span-2 font-mono text-slate-900 tabular-nums">
                      {prop.land_area_m2
                        ? `${(prop.land_area_m2 / 100).toFixed(2)} sotix (${prop.land_area_m2} m²)`
                        : 'Kiritilmagan'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 px-4 py-2.5">
                    <span className="text-slate-500">Qurilish / yashash maydoni</span>
                    <span className="col-span-2 font-mono text-slate-900 tabular-nums">
                      {prop.building_area_m2 ? `${prop.building_area_m2} m²` : 'Kiritilmagan'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 px-4 py-2.5">
                    <span className="text-slate-500">Devor materiali</span>
                    <span className="col-span-2 text-slate-900">
                      {prop.wall_material || 'Kiritilmagan'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 px-4 py-2.5">
                    <span className="text-slate-500">Muhandislik tarmoqlari</span>
                    <span className="col-span-2 text-slate-900">
                      {prop.utilities_info || 'Kiritilmagan'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 px-4 py-2.5">
                    <span className="text-slate-500">Ro‘yxatdan o‘tgan sana</span>
                    <span className="col-span-2 font-mono text-slate-900 tabular-nums">
                      {prop.registration_date || 'Rasmiylashtirilmagan / kiritilmagan'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Editable Address, Technical Passport & Notes Form */}
              <form
                onSubmit={handleSaveMetadata}
                className="space-y-3 pt-2 border-t border-slate-200"
              >
                <h3 className="text-xs font-bold text-slate-900">
                  Manzil, texnik ko‘rsatkichlar va amaliy izohni tahrirlash
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Manzil
                    </label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => {
                        setAddress(e.target.value);
                        setDirtyEdit(true);
                      }}
                      required
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Manzil kodi
                    </label>
                    <input
                      type="text"
                      value={addressCode}
                      onChange={(e) => {
                        setAddressCode(e.target.value);
                        setDirtyEdit(true);
                      }}
                      placeholder="UZ-1703-..."
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Qurilgan yili
                    </label>
                    <input
                      type="number"
                      min={1850}
                      max={2030}
                      value={builtYear}
                      onChange={(e) => {
                        setBuiltYear(e.target.value);
                        setDirtyEdit(true);
                      }}
                      placeholder="2014"
                      className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Qavatlar
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={floorsCount}
                      onChange={(e) => {
                        setFloorsCount(e.target.value);
                        setDirtyEdit(true);
                      }}
                      placeholder="1"
                      className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Xonalar soni
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={roomsCount}
                      onChange={(e) => {
                        setRoomsCount(e.target.value);
                        setDirtyEdit(true);
                      }}
                      placeholder="5"
                      className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Yer maydoni (m²)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={landAreaM2}
                      onChange={(e) => {
                        setLandAreaM2(e.target.value);
                        setDirtyEdit(true);
                      }}
                      placeholder="600"
                      className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Bino maydoni (m²)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={buildingAreaM2}
                      onChange={(e) => {
                        setBuildingAreaM2(e.target.value);
                        setDirtyEdit(true);
                      }}
                      placeholder="145"
                      className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Devor materiali
                    </label>
                    <input
                      type="text"
                      value={wallMaterial}
                      onChange={(e) => {
                        setWallMaterial(e.target.value);
                        setDirtyEdit(true);
                      }}
                      placeholder="Pishiq g‘isht / Shlakoblok"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Muhandislik tarmoqlari
                    </label>
                    <input
                      type="text"
                      value={utilitiesInfo}
                      onChange={(e) => {
                        setUtilitiesInfo(e.target.value);
                        setDirtyEdit(true);
                      }}
                      placeholder="Elektr, tabiiy gaz, ichimlik suvi"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Ro‘yxatdan o‘tgan sana
                    </label>
                    <input
                      type="date"
                      value={registrationDate}
                      onChange={(e) => {
                        setRegistrationDate(e.target.value);
                        setDirtyEdit(true);
                      }}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Izoh
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setDirtyEdit(true);
                    }}
                    placeholder="Obyekt bo‘yicha qo‘shimcha ma’lumot..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="submit"
                    disabled={!dirtyEdit || savingMeta}
                    className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg transition-colors cursor-pointer"
                  >
                    {savingMeta ? 'Saqlanmoqda...' : 'O‘zgarishlarni saqlash'}
                  </button>
                </div>
              </form>

              {/* Send to Inspection / Create Task Box */}
              <form
                onSubmit={handleCreateTask}
                className="pt-4 border-t border-slate-200 space-y-2.5"
              >
                <h3 className="text-xs font-bold text-slate-900">
                  Tekshiruvga yuborish / yangi topshiriq ochish
                </h3>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={taskReason}
                    onChange={(e) => setTaskReason(e.target.value)}
                    placeholder="Tekshiruv sababi (masalan: manzil yoki kadastr raqami aniqlashtirilsin)..."
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="submit"
                    disabled={!taskReason.trim() || creatingTask}
                    className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{creatingTask ? 'Yuborilmoqda...' : 'Tekshiruvga yuborish'}</span>
                  </button>
                </div>
              </form>
            </>
          ) : activeTab === 'confirm' ? (
            <div className="space-y-6">
              {!canConfirmOfficial ? (
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                  <div className="text-sm font-semibold text-slate-900">
                    Vakolat cheklovi (Mahalla vakili)
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Texnik topshiriqning 3.3 va 9-bandlariga muvofiq, mahalla vakili rasmiy
                    kadastr holatini o‘zboshimchalik bilan o‘zgartira olmaydi. Obyekt bo‘yicha
                    shubha yoki yangi ma’lumot mavjud bo‘lsa, “Obyekt ma’lumotlari” bo‘limidan
                    kadastr xodimiga tekshiruv so‘rovi yuboring.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleConfirmCadastre} className="space-y-4">
                  <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 leading-relaxed">
                    Rasmiy kadastr holatini faqat vakolatli davlat reyestri yoki joyiga chiqib
                    tuzilgan dalolatnoma asosida tasdiqlang. Har bir qaror muallif, vaqt va asos
                    bilan o‘zgarmas audit jurnaliga yoziladi.
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Tasdiqlanayotgan kadastr holati
                    </label>
                    <select
                      value={officialStatus}
                      onChange={(e) => setOfficialStatus(e.target.value as CadastralStatus)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="confirmed">Tasdiqlangan (Yashil)</option>
                      <option value="confirmed_absent">
                        Kadastr yo‘qligi tekshiruv orqali tasdiqlangan (Qizil)
                      </option>
                      <option value="unverified">
                        Aniqlanmagan — qayta tekshiruvga qaytarish (Sariq)
                      </option>
                    </select>
                  </div>

                  {officialStatus !== 'confirmed_absent' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Kadastr raqami {officialStatus === 'confirmed' ? '(majburiy)' : '(ixtiyoriy)'}
                      </label>
                      <input
                        type="text"
                        value={officialCadNum}
                        onChange={(e) => setOfficialCadNum(e.target.value)}
                        placeholder="17:03:401:01:02:0014"
                        required={officialStatus === 'confirmed'}
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Tekshiruv o‘tkazilgan vakolatli manba / hujjat raqami
                    </label>
                    <input
                      type="text"
                      value={authoritySource}
                      onChange={(e) => setAuthoritySource(e.target.value)}
                      required
                      placeholder="Masalan: Yagona kadastr axborot tizimi yoki Dalolatnoma #DN-450"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Tekshiruv xulosasi va asoslantiruvchi izoh
                    </label>
                    <textarea
                      rows={3}
                      value={officialComment}
                      onChange={(e) => setOfficialComment(e.target.value)}
                      required
                      placeholder="Tekshiruv natijasi va huquqiy asosni batafsil yozing..."
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingOfficial}
                    className="w-full py-2.5 px-4 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer"
                  >
                    {savingOfficial ? 'Tasdiqlanmoqda...' : 'Rasmiy holatni tasdiqlash va qayd etish'}
                  </button>
                </form>
              )}

              {/* Previous Inspections List */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <h3 className="text-xs font-bold text-slate-900">
                  O‘tkazilgan tekshiruvlar qaydlari ({data.inspections.length})
                </h3>
                {data.inspections.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Ushbu obyekt bo‘yicha hali rasmiy tekshiruv dalolatnomasi kiritilmagan.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                    {data.inspections.map((ins) => (
                      <div key={ins.id} className="p-3.5 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <CadastralStatusText status={ins.proposed_cadastral_status} />
                          <span className="font-mono text-[11px] text-slate-500">
                            {ins.inspected_at}
                          </span>
                        </div>
                        <div className="text-slate-800">{ins.comment}</div>
                        <div className="text-[11px] text-slate-500">
                          Manba: {ins.authority_source} · Xodim: {ins.inspector_name || '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'docs' ? (
            <div className="space-y-6">
              <form
                onSubmit={handleUploadAttachment}
                className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3"
              >
                <h3 className="text-xs font-bold text-slate-900">
                  Dalolatnoma yoki tasdiqlovchi hujjat biriktirish
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Hujjat nomi
                    </label>
                    <input
                      type="text"
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      required
                      placeholder="Masalan: Joyida o‘rganish dalolatnomasi"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Hujjat raqami (ixtiyoriy)
                    </label>
                    <input
                      type="text"
                      value={docNumber}
                      onChange={(e) => setDocNumber(e.target.value)}
                      placeholder="DN-2026/104"
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-slate-600" />
                    <span>
                      {selectedFile
                        ? `${selectedFile.name} (${Math.round(selectedFile.size / 1024)} KB)`
                        : 'Fayl tanlash (PDF, JPG, PNG, DOCX ≤ 2.5MB)'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={!selectedFile || !docTitle.trim() || uploadingDoc}
                    className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg cursor-pointer"
                  >
                    {uploadingDoc ? 'Yuklanmoqda...' : 'Biriktirish'}
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-900">Biriktirilgan hujjatlar</h3>
                {data.attachments.length === 0 ? (
                  <p className="text-xs text-slate-500">Hozircha hujjat biriktirilmagan.</p>
                ) : (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                    {data.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="p-3.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <FileText className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">
                              {att.doc_title}
                              {att.doc_number ? ` (${att.doc_number})` : ''}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {att.file_name} · {Math.max(1, Math.round(att.file_size / 1024))} KB ·{' '}
                              {att.uploaded_by_name || 'Xodim'} · {att.created_at}
                            </div>
                          </div>
                        </div>

                        {att.data_url && (
                          <a
                            href={att.data_url}
                            download={att.file_name}
                            className="px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded inline-flex items-center gap-1 shrink-0"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Yuklab olish</span>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-900">
                Obyekt ma’lumotlari va holatlari o‘zgarishi tarixi
              </h3>
              {data.history.length === 0 ? (
                <p className="text-xs text-slate-500">O‘zgarishlar qayd etilmagan.</p>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {data.history.map((log) => (
                    <div key={log.id} className="p-3.5 space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{log.actor_name}</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {log.created_at}
                        </span>
                      </div>
                      <div className="text-slate-700">{log.summary}</div>
                      {log.changes_json && (
                        <pre className="mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded font-mono text-[11px] text-slate-600 overflow-x-auto">
                          {log.changes_json}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
