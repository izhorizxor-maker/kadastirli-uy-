import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  Play,
  Search,
  X,
} from 'lucide-react';
import { apiRequest } from '../api';
import type { AuthUser, CadastralStatus, TaskItem } from '../types';
import { CadastralStatusText, InspectionStatusText } from './StatusIndicator';

interface TasksViewProps {
  currentUser: AuthUser;
  onOpenPropertyCard: (propertyId: number) => void;
  onFlyToMap: (propertyId: number, lat: number | null, lng: number | null) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

export function TasksView({
  currentUser,
  onOpenPropertyCard,
  onFlyToMap,
  onToast,
}: TasksViewProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<
    'all' | 'mine' | 'overdue' | 'in_progress' | 'needs_info' | 'completed'
  >(currentUser.role === 'inspector' ? 'mine' : 'all');
  const [q, setQ] = useState('');

  // Inspection Modal
  const [inspectingTask, setInspectingTask] = useState<TaskItem | null>(null);
  const [outcome, setOutcome] = useState<'completed' | 'needs_info' | 'reopened'>('completed');
  const [cadStatus, setCadStatus] = useState<CadastralStatus>('confirmed');
  const [cadNumber, setCadNumber] = useState('');
  const [authoritySource, setAuthoritySource] = useState(
    'Kadastr agentligi Yagona integratsiyalashgan axborot tizimi'
  );
  const [comment, setComment] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set('q', q.trim());
      if (filterMode === 'mine') qs.set('assignedToMe', 'true');
      else if (filterMode === 'overdue') qs.set('overdue', 'true');
      else if (filterMode !== 'all') qs.set('status', filterMode);

      const res = await apiRequest<TaskItem[]>(`/api/tasks?${qs.toString()}`);
      setTasks(res);
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [filterMode, q, onToast]);

  useEffect(() => {
    const t = setTimeout(loadTasks, 150);
    return () => clearTimeout(t);
  }, [loadTasks]);

  const handleAcceptTask = async (taskId: number) => {
    try {
      await apiRequest(`/api/tasks/${taskId}/accept`, { method: 'POST' });
      onToast('Topshiriq ijroga qabul qilindi ("Tekshirilmoqda").', 'success');
      loadTasks();
    } catch (err: any) {
      onToast(err.message, 'error');
    }
  };

  const openInspectDialog = (tk: TaskItem) => {
    setInspectingTask(tk);
    setOutcome(tk.status === 'completed' ? 'reopened' : 'completed');
    setCadStatus(
      tk.cadastral_status && tk.cadastral_status !== 'unverified'
        ? tk.cadastral_status
        : 'confirmed'
    );
    setCadNumber((tk as any).cadastral_number || '');
    setComment('');
    setReopenReason('');
  };

  const handleSubmitInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectingTask) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/tasks/${inspectingTask.id}/inspect`, {
        method: 'POST',
        body: JSON.stringify({
          outcome,
          cadastral_status: outcome === 'completed' ? cadStatus : 'unverified',
          cadastral_number: cadNumber || null,
          authority_source: authoritySource,
          comment,
          reopen_reason: reopenReason || null,
        }),
      });
      onToast('Tekshiruv natijasi tizimga va audit tarixiga saqlandi.', 'success');
      setInspectingTask(null);
      loadTasks();
    } catch (err: any) {
      onToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canExecuteInspection =
    currentUser.role === 'admin' || currentUser.role === 'inspector';

  return (
    <div className="p-6 space-y-5 max-w-[1440px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Tekshiruv topshiriqlari</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Kadastr holati aniqlanmagan yoki joylashuvi shubhali obyektlar bo‘yicha elektron ish
            oqimi
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {[
            { id: 'all' as const, label: 'Barchasi' },
            ...(currentUser.role === 'inspector'
              ? [{ id: 'mine' as const, label: 'Menga biriktirilgan' }]
              : []),
            { id: 'overdue' as const, label: 'Muddati o‘tgan' },
            { id: 'in_progress' as const, label: 'Tekshirilmoqda' },
            { id: 'needs_info' as const, label: 'Qo‘shimcha ma’lumot' },
            { id: 'completed' as const, label: 'Yakunlangan' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filterMode === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Obyekt ID, manzil yoki sabab..."
            className="pl-8 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {/* Tasks Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-2.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            Tanlangan filtr bo‘yicha tekshiruv topshiriqlari topilmadi.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-4"># / Obyekt</th>
                  <th className="py-2.5 px-3">Tekshiruv sababi va xulosa</th>
                  <th className="py-2.5 px-3">Mas’ul xodim</th>
                  <th className="py-2.5 px-3">Joriy holati</th>
                  <th className="py-2.5 px-3">Kadastr holati</th>
                  <th className="py-2.5 px-3">Muddati</th>
                  <th className="py-2.5 px-4 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {tasks.map((tk) => {
                  const isOverdue =
                    tk.status !== 'completed' &&
                    tk.due_date &&
                    tk.due_date < new Date().toISOString().slice(0, 10);

                  return (
                    <tr key={tk.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-mono font-semibold text-slate-900">
                          #{tk.id} · {tk.system_uid}
                        </div>
                        <div className="text-slate-700">{tk.property_address}</div>
                        <div className="text-[11px] text-slate-500">
                          {tk.tuman_name} · {tk.mahalla_name}
                        </div>
                      </td>
                      <td className="py-3 px-3 max-w-xs">
                        <div className="text-slate-800">{tk.reason}</div>
                        {tk.result_summary && (
                          <div className="text-[11px] text-emerald-800 mt-1">
                            Natija: {tk.result_summary}
                          </div>
                        )}
                        {tk.reopen_reason && (
                          <div className="text-[11px] text-amber-800 mt-0.5">
                            Qayta ochish sababi: {tk.reopen_reason}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                        {tk.assigned_to_name || (
                          <span className="text-amber-700">Biriktirilmagan</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <InspectionStatusText status={tk.status} />
                      </td>
                      <td className="py-3 px-3">
                        <CadastralStatusText status={tk.cadastral_status || 'unverified'} />
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums whitespace-nowrap">
                        <span className={isOverdue ? 'text-red-700 font-semibold' : 'text-slate-700'}>
                          {tk.due_date || '—'}
                        </span>
                        {isOverdue && (
                          <div className="text-[10px] text-red-600">Muddati o‘tgan</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                        {tk.latitude != null && tk.longitude != null && (
                          <button
                            type="button"
                            onClick={() =>
                              onFlyToMap(tk.property_id, tk.latitude ?? null, tk.longitude ?? null)
                            }
                            className="text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-0.5 cursor-pointer"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            <span>Xarita</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenPropertyCard(tk.property_id)}
                          className="text-xs font-medium text-slate-700 hover:text-slate-900 underline cursor-pointer"
                        >
                          Karta
                        </button>

                        {canExecuteInspection &&
                          (tk.status === 'sent_for_inspection' || tk.status === 'assigned') && (
                            <button
                              type="button"
                              onClick={() => handleAcceptTask(tk.id)}
                              className="px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Play className="w-3 h-3" />
                              <span>Qabul qilish</span>
                            </button>
                          )}

                        {canExecuteInspection && (
                          <button
                            type="button"
                            onClick={() => openInspectDialog(tk)}
                            className="px-2.5 py-1 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ClipboardCheck className="w-3 h-3" />
                            <span>
                              {tk.status === 'completed' ? 'O‘zgartirish' : 'Natija kiritish'}
                            </span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inspection Result Entry Modal */}
      {inspectingTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono text-slate-500">
                  Topshiriq #{inspectingTask.id} · {inspectingTask.system_uid}
                </div>
                <h2 className="text-base font-bold text-slate-900">
                  Tekshiruv natijasini qayd etish
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setInspectingTask(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitInspection} className="p-5 space-y-3.5 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700">
                <div className="font-semibold text-slate-900">{inspectingTask.property_address}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Sabab: {inspectingTask.reason}
                </div>
              </div>

              {inspectingTask.status === 'completed' && (
                <div>
                  <label className="block font-semibold text-amber-900 mb-1">
                    Yakunlangan topshiriqni o‘zgartirish sababi (majburiy — TZ 10-bo‘lim)
                  </label>
                  <input
                    type="text"
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    required
                    placeholder="Masalan: Mulkdor yangi arxiv hujjatini taqdim etdi..."
                    className="w-full px-3 py-2 border border-amber-400 bg-amber-50/40 rounded-lg"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tekshiruv jarayoni qarori
                </label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="completed">Tekshiruvni yakunlash va holatni tasdiqlash</option>
                  <option value="needs_info">
                    Qo‘shimcha ma’lumot talab qilinadi (kadastr holati aniqlanmagan qoladi)
                  </option>
                  <option value="reopened">Qayta tekshiruvga qaytarish</option>
                </select>
              </div>

              {outcome === 'completed' && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Tasdiqlangan rasmiy kadastr holati
                    </label>
                    <select
                      value={cadStatus}
                      onChange={(e) => setCadStatus(e.target.value as CadastralStatus)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="confirmed">Tasdiqlangan (Yashil)</option>
                      <option value="confirmed_absent">
                        Kadastr yo‘qligi tekshiruv orqali tasdiqlangan (Qizil)
                      </option>
                    </select>
                  </div>

                  {cadStatus === 'confirmed' && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Kadastr raqami (majburiy)
                      </label>
                      <input
                        type="text"
                        value={cadNumber}
                        onChange={(e) => setCadNumber(e.target.value)}
                        required
                        placeholder="17:03:401:01:02:0014"
                        className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tekshirilgan vakolatli manba / Dalolatnoma
                </label>
                <input
                  type="text"
                  value={authoritySource}
                  onChange={(e) => setAuthoritySource(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tekshiruv xulosasi va izoh
                </label>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  required
                  placeholder="Tekshiruv bo‘yicha batafsil xulosa..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInspectingTask(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Saqlanmoqda...' : 'Natijani saqlash'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
