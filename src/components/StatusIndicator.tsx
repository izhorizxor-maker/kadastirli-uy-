import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  MapPinOff,
  RotateCcw,
  Send,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  CADASTRAL_STATUS_LABELS,
  INSPECTION_STATUS_LABELS,
  MARKER_COLOR_LABELS,
  type CadastralStatus,
  type InspectionStatus,
  type MarkerColor,
} from '../types';

export function CadastralStatusText({ status }: { status: CadastralStatus }) {
  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        <span>{CADASTRAL_STATUS_LABELS.confirmed}</span>
      </span>
    );
  }
  if (status === 'confirmed_absent') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0 text-red-600" />
        <span>{CADASTRAL_STATUS_LABELS.confirmed_absent}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
      <HelpCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
      <span>{CADASTRAL_STATUS_LABELS.unverified}</span>
    </span>
  );
}

export function InspectionStatusText({ status }: { status: InspectionStatus }) {
  switch (status) {
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
          <span>{INSPECTION_STATUS_LABELS.completed}</span>
        </span>
      );
    case 'in_progress':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-blue-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0 text-blue-600" />
          <span>{INSPECTION_STATUS_LABELS.in_progress}</span>
        </span>
      );
    case 'assigned':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-700 whitespace-nowrap">
          <UserCheck className="w-3.5 h-3.5 shrink-0 text-slate-500" />
          <span>{INSPECTION_STATUS_LABELS.assigned}</span>
        </span>
      );
    case 'needs_info':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
          <span>{INSPECTION_STATUS_LABELS.needs_info}</span>
        </span>
      );
    case 'reopened':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-800 whitespace-nowrap">
          <RotateCcw className="w-3.5 h-3.5 shrink-0 text-amber-600" />
          <span>{INSPECTION_STATUS_LABELS.reopened}</span>
        </span>
      );
    case 'sent_for_inspection':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
          <Send className="w-3.5 h-3.5 shrink-0 text-slate-500" />
          <span>{INSPECTION_STATUS_LABELS.sent_for_inspection}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap">
          <span>{INSPECTION_STATUS_LABELS.new}</span>
        </span>
      );
  }
}

export function MarkerCategoryText({ color }: { color: MarkerColor }) {
  if (color === 'green') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        <span>Yashil · Tasdiqlangan</span>
      </span>
    );
  }
  if (color === 'red') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0 text-red-600" />
        <span>Qizil · Yo‘qligi tasdiqlangan</span>
      </span>
    );
  }
  if (color === 'gray') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
        <MapPinOff className="w-3.5 h-3.5 shrink-0 text-slate-500" />
        <span>Kulrang · Joylashuvsiz</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
      <span>Sariq · Tekshiruv talab</span>
    </span>
  );
}

export function getMarkerLabel(color: MarkerColor): string {
  return MARKER_COLOR_LABELS[color];
}
