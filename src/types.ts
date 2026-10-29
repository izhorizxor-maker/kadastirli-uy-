export type UserRole = 'admin' | 'inspector' | 'mahalla';

export type CadastralStatus = 'confirmed' | 'confirmed_absent' | 'unverified';

export type InspectionStatus =
  | 'new'
  | 'sent_for_inspection'
  | 'assigned'
  | 'in_progress'
  | 'needs_info'
  | 'completed'
  | 'reopened';

export type MarkerColor = 'green' | 'yellow' | 'red' | 'gray';

export type ObjectType = 'residential_house' | 'land_parcel' | 'auxiliary_building';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  inspector: 'Kadastr xodimi',
  mahalla: 'Mahalla yettiligi',
};

export interface MapGeoCandidate {
  id: string;
  display_name: string;
  short_address: string;
  lat: number;
  lng: number;
  type: string;
  zoom?: number;
  category_label?: string;
}

export interface UzDistrictItem {
  code: string;
  name: string;
  lat: number;
  lng: number;
  zoom?: number;
}

export interface UzRegionDirectoryItem {
  code: string;
  name: string;
  lat: number;
  lng: number;
  zoom: number;
  districts: UzDistrictItem[];
}

export interface MapAddressSearchResponse {
  dbMatches: PropertyRecord[];
  geoMatches: MapGeoCandidate[];
}

export const CADASTRAL_STATUS_LABELS: Record<CadastralStatus, string> = {
  confirmed: 'Tasdiqlangan',
  confirmed_absent: 'Kadastr yo‘qligi tasdiqlangan',
  unverified: 'Aniqlanmagan',
};

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  new: 'Yangi',
  sent_for_inspection: 'Tekshiruvga yuborilgan',
  assigned: 'Mas’ul xodimga biriktirilgan',
  in_progress: 'Tekshirilmoqda',
  needs_info: 'Qo‘shimcha ma’lumot talab qilinadi',
  completed: 'Tekshiruv yakunlangan',
  reopened: 'Qayta tekshiruvga yuborilgan',
};

export const MARKER_COLOR_LABELS: Record<MarkerColor, string> = {
  green: 'Tasdiqlangan (Yashil)',
  yellow: 'Tekshiruv talab qilinadi (Sariq)',
  red: 'Kadastr yo‘qligi tasdiqlangan (Qizil)',
  gray: 'Joylashuv yoki ma’lumot aniqlanmagan (Kulrang)',
};

export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  residential_house: 'Uy-joy binosi',
  land_parcel: 'Yer uchastkasi',
  auxiliary_building: 'Qo‘shimcha bino / imorat',
};

export function computeMarkerColor(p: {
  cadastral_status: CadastralStatus;
  latitude: number | null;
  longitude: number | null;
  location_verified: number | boolean;
}): MarkerColor {
  const hasCoords =
    p.latitude !== null &&
    p.longitude !== null &&
    !Number.isNaN(Number(p.latitude)) &&
    !Number.isNaN(Number(p.longitude)) &&
    Boolean(p.location_verified);

  if (!hasCoords) {
    return 'gray';
  }
  if (p.cadastral_status === 'confirmed') {
    return 'green';
  }
  if (p.cadastral_status === 'confirmed_absent') {
    return 'red';
  }
  return 'yellow';
}

export interface RegionItem {
  id: number;
  name: string;
  level: 'viloyat' | 'tuman' | 'mahalla';
  parent_id: number | null;
  code: string;
  center_lat: number;
  center_lng: number;
  default_zoom: number;
}

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  position: string | null;
  viloyat_id: number | null;
  tuman_id: number | null;
  mahalla_id: number | null;
  viloyat_name?: string | null;
  tuman_name?: string | null;
  mahalla_name?: string | null;
  is_blocked: number;
  last_login_at: string | null;
  created_at: string;
}

export interface PropertyRecord {
  id: number;
  system_uid: string;
  viloyat_id: number;
  tuman_id: number;
  mahalla_id: number;
  viloyat_name?: string;
  tuman_name?: string;
  mahalla_name?: string;
  address: string;
  address_code: string | null;
  parent_parcel_code: string | null;
  object_type: ObjectType;
  latitude: number | null;
  longitude: number | null;
  location_verified: number;
  pending_lat: number | null;
  pending_lng: number | null;
  pending_location_note: string | null;
  pending_location_by_name?: string | null;
  cadastral_number: string | null;
  cadastral_status: CadastralStatus;
  inspection_status: InspectionStatus;
  source: string;
  source_date: string | null;
  assigned_user_id: number | null;
  assigned_user_name?: string | null;
  last_inspected_at: string | null;
  notes: string | null;
  owner_reference: string | null;
  built_year: number | null;
  floors_count: number | null;
  rooms_count: number | null;
  land_area_m2: number | null;
  building_area_m2: number | null;
  wall_material: string | null;
  utilities_info: string | null;
  registration_date: string | null;
  created_at: string;
  updated_at: string;
  marker_color: MarkerColor;
}

export interface ClickedBuildingInspection {
  matchedProperty: PropertyRecord | null;
  lat: number;
  lng: number;
  address: string;
  street_house: string | null;
  mahalla_or_village: string | null;
  district: string | null;
  region: string | null;
  osmBuilding: {
    found: boolean;
    name: string | null;
    building_type_label: string;
    built_year: number | null;
    floors_count: number | null;
    wall_material: string | null;
    roof_material: string | null;
    footprint_area_m2: number | null;
    house_number: string | null;
    street: string | null;
    polygon: [number, number][] | null;
  };
}

export interface CadastralRecordItem {
  id: number;
  property_id: number;
  cadastral_number: string;
  land_area_sqm: number | null;
  building_area_sqm: number | null;
  source_authority: string;
  verification_doc_ref: string | null;
  recorded_at: string;
}

export interface InspectionItem {
  id: number;
  property_id: number;
  task_id: number | null;
  inspector_id: number;
  inspector_name?: string;
  cadastral_number_checked: string | null;
  authority_source: string;
  proposed_cadastral_status: CadastralStatus;
  inspection_outcome: InspectionStatus;
  comment: string;
  inspected_at: string;
}

export interface TaskItem {
  id: number;
  property_id: number;
  system_uid?: string;
  property_address?: string;
  tuman_name?: string;
  mahalla_name?: string;
  cadastral_status?: CadastralStatus;
  latitude?: number | null;
  longitude?: number | null;
  assigned_to: number | null;
  assigned_to_name?: string | null;
  created_by: number;
  created_by_name?: string;
  reason: string;
  status: InspectionStatus;
  due_date: string | null;
  result_summary: string | null;
  reopen_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AttachmentItem {
  id: number;
  property_id: number;
  task_id: number | null;
  doc_title: string;
  doc_number: string | null;
  file_name: string;
  mime_type: string;
  file_size: number;
  data_url: string | null;
  uploaded_by: number;
  uploaded_by_name?: string;
  created_at: string;
}

export interface AuditLogItem {
  id: number;
  actor_id: number | null;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  property_id: number | null;
  summary: string;
  changes_json: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  user_id: number;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: number | null;
  is_read: number;
  created_at: string;
}

export interface ImportBatchItem {
  id: number;
  filename: string;
  uploaded_by: number;
  uploaded_by_name?: string;
  total_rows: number;
  inserted_count: number;
  updated_count: number;
  flagged_count: number;
  error_count: number;
  duplicate_count: number;
  errors_json: string;
  summary_json: string;
  created_at: string;
}

export interface ExcelPreviewRow {
  rowNumber: number;
  action: 'insert' | 'update' | 'conflict_review' | 'error' | 'duplicate_in_file';
  system_uid: string;
  cadastral_number: string | null;
  viloyat: string;
  tuman: string;
  mahalla: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  location_verified: boolean;
  source: string;
  source_date: string;
  resulting_cadastral_status: CadastralStatus;
  resulting_marker_color: MarkerColor;
  messages: string[];
  existing_property_id?: number;
  tuman_id?: number;
  mahalla_id?: number;
}

export interface ExcelPreviewResponse {
  previewToken: string;
  filename: string;
  totalRows: number;
  validInsertCount: number;
  validUpdateCount: number;
  conflictReviewCount: number;
  duplicateInFileCount: number;
  errorCount: number;
  missingCoordsCount: number;
  missingCadastreCount: number;
  columnsDetected: string[];
  rows: ExcelPreviewRow[];
}

export interface BackupFileInfo {
  filename: string;
  size_bytes: number;
  created_at: string;
  created_by: string;
  record_counts: {
    properties: number;
    tasks: number;
    users: number;
    audit_logs: number;
  };
}

export interface SystemTestResult {
  id: number;
  suite_name: string;
  passed: number;
  total_checks: number;
  passed_checks: number;
  details_json: string;
  executed_by_name: string;
  executed_at: string;
}
