export type UnitStatus = 'VACANT' | 'OCCUPIED';
export type LeaseType = 'Rental' | 'Lease';
export type PaymentStatus =
  | 'Unpaid'
  | 'Partially Paid'
  | 'Partially Paid & Closed'
  | 'Paid & Closed';
export type UtilityProvider = 'BESCOM' | 'TNEB';

export interface PropertyHouse {
  property_id: string;
  property_name: string;
  address: string;
  total_floors: number;
  common_eb_rr_number: string;
  utility_provider: UtilityProvider;
}

export interface Unit {
  unit_id: string;
  property_id: string;
  unit_name: string;
  unit_type: string; // e.g., 2BHK, 1BHK, 1RK, 3BHK
  floor: string; // e.g., Ground Floor, 1st Floor, 2nd Floor, 3rd Floor
  eb_rr_number: string;
  water_rr_number: string;
  water_rr_number2?: string;
  status: UnitStatus;
  current_tenant_id: string | null;
  last_water_reading_1: number;
  last_water_reading_2: number;
}

export interface DeductionRow {
  id: string;
  deduction_reason: string;
  amount: number;
}

export interface TenantAgreementFile {
  name: string;
  mime_type: string;
  size_bytes: number;
  data_url: string;
  server_url?: string;
  uploaded_at: string;
}

export interface TenantRecord {
  id: string;
  property_id: string;
  unit_id: string;
  full_name: string;
  whatsapp_phone: string;
  move_in_date: string;
  tenure_months: number; // Default 11 or 12 months
  lease_end_date: string; // YYYY-MM-DD auto-calculated from move_in_date + tenure_months
  move_out_date: string | null;
  lease_type: LeaseType;
  monthly_rent: number; // 0 if Lease
  security_deposit: number; // 0 if Lease
  lease_deposit: number; // 0 if Rental
  monthly_maintenance_charge: number; // Fixed Monthly Cleaning Fee (Rental & Lease)
  water_charge: number; // Decimal rate per unit
  initial_water_reading_1: number;
  initial_water_reading_2: number;
  is_active: boolean;
  agreement_file?: TenantAgreementFile | null;
  agreement_url?: string;
  deductions?: DeductionRow[];
  final_refundable_amount?: number;
}

export interface AdditionalChargeItem {
  id: string;
  charge_name: string;
  charge_amount: number;
}

// Strict Rule: ONE Building Maintenance Bill per House/Property per Month
export interface HouseMaintenanceBill {
  id: string;
  property_id: string;
  billing_month: string; // YYYY-MM (UNIQUE(property_id, billing_month))
  common_eb_amount: number;
  additional_charges: AdditionalChargeItem[];
  total_house_maintenance: number;
  updated_at: string;
}

export interface UtilityReading {
  id: string;
  property_id: string;
  unit_id: string;
  billing_month: string; // YYYY-MM
  eb_bill_amount: number;
  eb_paid_to_owner: boolean;
  prev_reading_1: number;
  curr_reading_1: number;
  prev_reading_2: number;
  curr_reading_2: number;
  net_consumption: number;
  water_rate: number;
  water_bill_amount: number;
  captured_at: string;
}

export interface InvoiceRecord {
  id: string;
  property_id: string;
  property_name: string;
  unit_id: string;
  tenant_id: string;
  billing_month: string; // YYYY-MM (UNIQUE(unit_id, tenant_id, billing_month))
  unit_name: string;
  unit_type: string;
  floor: string;
  tenant_name: string;
  whatsapp_phone: string;
  lease_type: LeaseType;
  rent_amount: number;
  tenant_cleaning_fee: number; // Fixed monthly cleaning fee agreed with tenant
  building_maintenance_total: number; // Whole house variable building maintenance bill
  building_unit_count: number; // Total units in the house used for equal division
  building_maintenance_share: number; // Equal per-unit share = total / unit_count
  building_maintenance_items: Array<{ name: string; amount: number }>;
  eb_amount: number;
  eb_paid_to_owner: boolean;
  water_prev_1: number;
  water_curr_1: number;
  water_prev_2: number;
  water_curr_2: number;
  water_net_units: number;
  water_rate: number;
  water_amount: number;
  carried_forward_balance: number; // Arrears carried from prior Partially Paid & Closed invoice
  total_bill_value: number;
  total_payable_to_owner: number;
  amount_paid: number;
  balance_due: number;
  payment_status: PaymentStatus;
  is_locked: boolean; // True when 'Partially Paid & Closed' or 'Paid & Closed'
  upi_link: string;
  due_date?: string;
  generated_at: string;
  paid_at: string | null;
  closed_at: string | null;
}

export type UserRole = 'Owner';

export interface AuthSession {
  role: UserRole;
  accountLabel?: 'Owner 1' | 'Owner 2';
  username: string;
  loginMethod: 'password' | 'biometric';
  authenticatedAt: string;
}

export interface RoleAccountCredential {
  username: string;
  pin: string;
}

export interface RoleCredentialsConfig {
  Owner1: RoleAccountCredential;
  Owner2: RoleAccountCredential;
}

export type AutoLockTimerMode = 'immediate' | '5m' | '15m' | '30m';

export interface AppSettings {
  merchant_upi_id: string;
  merchant_name: string;
  owner_whatsapp_phone: string;
  last_synced_at: string | null;
  auth_credentials?: RoleCredentialsConfig;
  auto_lock_timer?: AutoLockTimerMode;
}

export type SyncStatus = 'Synced' | 'Syncing...' | 'Offline/Error';

export interface TabSyncStatus {
  tab: string;
  ok: boolean;
  httpStatus?: number;
  rows?: number;
  created?: boolean;
  error?: string;
}

export interface SyncDiagnostics {
  connected: boolean;
  authMode: 'service_account' | 'iam_impersonation' | 'none';
  httpStatus?: number;
  tokenStatus?: string;
  message: string;
  testedAt: string;
  tabStatuses: TabSyncStatus[];
}

export type ExpenseCategory =
  | 'Plumbing / Repairs'
  | 'Painting & Maintenance'
  | 'Property Tax & Municipal'
  | 'Common Area EB / Water'
  | 'Cleaning & Security'
  | 'Other';

export interface ExpenseRecord {
  id: string;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  house_id: string; // property_id or 'OTHER'
  house_name: string; // property_name or 'General / Other'
  category: ExpenseCategory;
  description: string;
  amount: number;
  created_by: string;
}

export type RequestCategory = 'Plumbing' | 'Electrical' | 'Painting' | 'Other';
export type RequestStatus = 'Open' | 'In Progress' | 'Resolved';

export interface MaintenanceRequest {
  id: string;
  property_id: string;
  property_name: string;
  unit_id: string;
  unit_name: string;
  tenant_id: string;
  tenant_name: string;
  category: RequestCategory;
  title: string;
  description: string;
  status: RequestStatus;
  reported_by: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note?: string;
}

export interface EstateDataset {
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  houseMaintenanceBills: HouseMaintenanceBill[];
  utilityReadings: UtilityReading[];
  invoices: InvoiceRecord[];
  expenses: ExpenseRecord[];
  requests?: MaintenanceRequest[];
  settings: AppSettings;
}

export type AppView =
  | 'dashboard'
  | 'properties'
  | 'units'
  | 'tenants'
  | 'maintenance'
  | 'meters'
  | 'invoices'
  | 'expenses'
  | 'add-expense'
  | 'announcements'
  | 'profile';
