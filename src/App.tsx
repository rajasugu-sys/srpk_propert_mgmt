import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Fingerprint,
  Home,
  Receipt,
  User,
  X,
} from 'lucide-react';
import { AddExpensesView } from './components/AddExpensesView';
import { AnnouncementsView } from './components/AnnouncementsView';
import { ExpensesView } from './components/ExpensesView';
import { InvoicesView } from './components/InvoicesView';
import { LoginGate } from './components/LoginGate';
import { MaintenanceView } from './components/MaintenanceView';
import { MasterDashboard } from './components/MasterDashboard';
import { ProfileView } from './components/ProfileView';
import { InstallAppModal, OfflineIndicator } from './components/PWAControls';
import { SettingsModal } from './components/SettingsModal';
import { TenantLifecycleView } from './components/TenantLifecycleView';
import { UnitsManagementView } from './components/UnitsManagementView';
import { UtilityMeterCapture } from './components/UtilityMeterCapture';
import {
  clearHiddenAtTimestamp,
  evaluateSessionLockStatus,
  getAuthFetchHeaders,
  isValidAutoLockMode,
  loadAutoLockTimerMode,
  loadPersistedAuthSession,
  recordHiddenAtTimestamp,
  recordLastActivityTimestamp,
  saveAutoLockTimerMode,
  savePersistedAuthSession,
} from './config/authConfig';
import {
  DEFAULT_APP_SETTINGS,
  INITIAL_ESTATE_DATASET,
  INITIAL_EXPENSES,
} from './data/initialEstateData';
import {
  isBiometricEnrolledForUser,
  isPlatformBiometricSupported,
  registerPlatformBiometric,
} from './services/biometricAuth';
import {
  fetchSheetsConfigStatus,
  pullAllFromGoogleSheet,
  pushAllTablesToGoogleSheet,
  REQUIRED_SHEET_TABS,
  SPREADSHEET_ID,
  SPREADSHEET_URL,
  SyncTable,
  syncTableToGoogleSheet,
  testConnectionAndSyncNow,
} from './services/googleSheetsSync';
import {
  AppSettings,
  AppView,
  AuthSession,
  AutoLockTimerMode,
  DeductionRow,
  EstateDataset,
  ExpenseCategory,
  ExpenseRecord,
  HouseMaintenanceBill,
  InvoiceRecord,
  PaymentStatus,
  PropertyHouse,
  SyncDiagnostics,
  SyncStatus,
  TenantAgreementFile,
  TenantRecord,
  Unit,
  UtilityReading,
} from './types/estate';
import {
  buildDefaultWaterReference,
  calculateLeaseEndDate,
  getTenureRemainingInfo,
  isInvoiceLockedStatus,
} from './utils/billingEngine';

const LOCAL_STORAGE_KEY = 'srpk_hierarchy_estate_v5';

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(v: unknown, fallback = true): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return fallback;
}

function normalizePaymentStatus(rawStatus: unknown): PaymentStatus {
  const s = String(rawStatus || '').trim();
  if (s === 'Paid & Closed' || s.toUpperCase() === 'PAID') return 'Paid & Closed';
  if (s === 'Partially Paid & Closed') return 'Partially Paid & Closed';
  if (s === 'Partially Paid') return 'Partially Paid';
  return 'Unpaid';
}

function migrateTenantRecord(raw: Record<string, unknown>): TenantRecord {
  const moveIn = String(raw.move_in_date || new Date().toISOString().slice(0, 10));
  const tenure = Math.max(1, toNum(raw.tenure_months, 11));
  const endDate =
    typeof raw.lease_end_date === 'string' && raw.lease_end_date.trim()
      ? raw.lease_end_date.trim()
      : calculateLeaseEndDate(moveIn, tenure);

  let agreementFile = (raw.agreement_file as TenantAgreementFile | null | undefined) || null;
  if (typeof raw.agreement_file === 'string' && raw.agreement_file.startsWith('{')) {
    try {
      agreementFile = JSON.parse(raw.agreement_file) as TenantAgreementFile;
    } catch {
      agreementFile = null;
    }
  }

  let deductions = Array.isArray(raw.deductions)
    ? (raw.deductions as DeductionRow[])
    : undefined;
  if (typeof raw.deductions === 'string' && raw.deductions.startsWith('[')) {
    try {
      deductions = JSON.parse(raw.deductions) as DeductionRow[];
    } catch {
      deductions = undefined;
    }
  }

  return {
    id: String(raw.id || ''),
    property_id: String(raw.property_id || ''),
    unit_id: String(raw.unit_id || ''),
    full_name: String(raw.full_name || ''),
    whatsapp_phone: String(raw.whatsapp_phone || ''),
    move_in_date: moveIn,
    tenure_months: tenure,
    lease_end_date: endDate,
    move_out_date: raw.move_out_date ? String(raw.move_out_date) : null,
    lease_type: raw.lease_type === 'Lease' ? 'Lease' : 'Rental',
    monthly_rent: toNum(raw.monthly_rent, 0),
    security_deposit: toNum(raw.security_deposit, 0),
    lease_deposit: toNum(raw.lease_deposit, 0),
    monthly_maintenance_charge: toNum(raw.monthly_maintenance_charge, 0),
    water_charge: toNum(raw.water_charge, 45),
    initial_water_reading_1: toNum(raw.initial_water_reading_1, 0),
    initial_water_reading_2: toNum(raw.initial_water_reading_2, 0),
    is_active: toBool(raw.is_active, true),
    agreement_file: agreementFile,
    agreement_url: raw.agreement_url ? String(raw.agreement_url) : agreementFile?.server_url || '',
    deductions,
    final_refundable_amount:
      raw.final_refundable_amount !== undefined && raw.final_refundable_amount !== ''
        ? toNum(raw.final_refundable_amount, 0)
        : undefined,
  };
}

function migrateInvoiceRecord(rawInv: Record<string, unknown>): InvoiceRecord {
  const cleaningFee =
    rawInv.tenant_cleaning_fee !== undefined && rawInv.tenant_cleaning_fee !== ''
      ? toNum(rawInv.tenant_cleaning_fee, 0)
      : toNum(rawInv.maintenance_charge, 0);

  const paymentStatus = normalizePaymentStatus(rawInv.payment_status);
  const isLocked =
    typeof rawInv.is_locked === 'boolean'
      ? rawInv.is_locked
      : isInvoiceLockedStatus(paymentStatus);

  const totalPayable = toNum(rawInv.total_payable_to_owner, 0);
  const amountPaid =
    rawInv.amount_paid !== undefined && rawInv.amount_paid !== ''
      ? toNum(rawInv.amount_paid, 0)
      : paymentStatus === 'Paid & Closed'
        ? totalPayable
        : 0;
  const balanceDue =
    rawInv.balance_due !== undefined && rawInv.balance_due !== ''
      ? toNum(rawInv.balance_due, 0)
      : paymentStatus === 'Paid & Closed'
        ? 0
        : Math.max(0, totalPayable - amountPaid);

  let bldgItems = Array.isArray(rawInv.building_maintenance_items)
    ? (rawInv.building_maintenance_items as Array<{ name: string; amount: number }>)
    : [];
  if (
    typeof rawInv.building_maintenance_items === 'string' &&
    rawInv.building_maintenance_items.startsWith('[')
  ) {
    try {
      bldgItems = JSON.parse(rawInv.building_maintenance_items) as Array<{
        name: string;
        amount: number;
      }>;
    } catch {
      bldgItems = [];
    }
  }

  return {
    ...(rawInv as unknown as InvoiceRecord),
    rent_amount: toNum(rawInv.rent_amount, 0),
    tenant_cleaning_fee: cleaningFee,
    building_maintenance_total: toNum(rawInv.building_maintenance_total, 0),
    building_unit_count: toNum(rawInv.building_unit_count, 0),
    building_maintenance_share: toNum(rawInv.building_maintenance_share, 0),
    building_maintenance_items: bldgItems,
    eb_amount: toNum(rawInv.eb_amount, 0),
    eb_paid_to_owner: toBool(rawInv.eb_paid_to_owner, true),
    water_prev_1: toNum(rawInv.water_prev_1, 0),
    water_curr_1: toNum(rawInv.water_curr_1, 0),
    water_prev_2: toNum(rawInv.water_prev_2, 0),
    water_curr_2: toNum(rawInv.water_curr_2, 0),
    water_net_units: toNum(rawInv.water_net_units, 0),
    water_rate: toNum(rawInv.water_rate, 0),
    water_amount: toNum(rawInv.water_amount, 0),
    carried_forward_balance: toNum(rawInv.carried_forward_balance, 0),
    total_bill_value: toNum(rawInv.total_bill_value, 0),
    total_payable_to_owner: totalPayable,
    amount_paid: amountPaid,
    balance_due: balanceDue,
    payment_status: paymentStatus,
    is_locked: isLocked,
    paid_at: rawInv.paid_at ? String(rawInv.paid_at) : null,
    closed_at: rawInv.closed_at ? String(rawInv.closed_at) : null,
    keb_account_id: rawInv.keb_account_id ? String(rawInv.keb_account_id) : undefined,
    water_reference: rawInv.water_reference ? String(rawInv.water_reference) : undefined,
    motor_bill_amount:
      rawInv.motor_bill_amount !== undefined && rawInv.motor_bill_amount !== ''
        ? toNum(rawInv.motor_bill_amount, 0)
        : undefined,
    others_amount:
      rawInv.others_amount !== undefined && rawInv.others_amount !== ''
        ? toNum(rawInv.others_amount, 0)
        : undefined,
  };
}

const VALID_EXPENSE_CATEGORIES = new Set<ExpenseCategory>([
  'Plumbing / Repairs',
  'Painting & Maintenance',
  'Property Tax & Municipal',
  'Common Area EB / Water',
  'Cleaning & Security',
  'Other',
]);

function migrateExpenseRecord(raw: Record<string, unknown>): ExpenseRecord {
  const dateStr = String(raw.date || new Date().toISOString().slice(0, 10));
  const rawMonth = String(raw.month || '').trim();
  const monthStr = rawMonth || dateStr.slice(0, 7);
  const rawCategory = String(raw.category || 'Other') as ExpenseCategory;
  return {
    id: String(raw.id || `EXP-${Date.now()}`),
    date: dateStr,
    month: monthStr,
    house_id: String(raw.house_id || 'OTHER'),
    house_name: String(raw.house_name || 'General / Other'),
    category: VALID_EXPENSE_CATEGORIES.has(rawCategory) ? rawCategory : 'Other',
    description: String(raw.description || ''),
    amount: Math.max(0, toNum(raw.amount, 0)),
    created_by: String(raw.created_by || 'Owner'),
  };
}

function migrateDataset(raw: EstateDataset): EstateDataset {
  const rawSettings = (raw.settings || {}) as unknown as Record<string, unknown>;
  const { service_account_email: _ignoredEmail, ...cleanRawSettings } = rawSettings;
  const mergedSettings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...(cleanRawSettings as Partial<AppSettings>),
  };

  return {
    ...raw,
    tenants: Array.isArray(raw.tenants)
      ? raw.tenants.map((t) =>
          migrateTenantRecord(t as unknown as Record<string, unknown>)
        )
      : [],
    invoices: Array.isArray(raw.invoices)
      ? raw.invoices.map((inv) =>
          migrateInvoiceRecord(inv as unknown as Record<string, unknown>)
        )
      : [],
    expenses: Array.isArray(raw.expenses)
      ? raw.expenses.map((exp) =>
          migrateExpenseRecord(exp as unknown as Record<string, unknown>)
        )
      : INITIAL_EXPENSES,
    users: Array.isArray(raw.users) ? raw.users : [],
    settings: mergedSettings,
  };
}

function loadLocalDataset(): EstateDataset {
  try {
    const raw =
      localStorage.getItem(LOCAL_STORAGE_KEY) ||
      localStorage.getItem('srpk_hierarchy_estate_v4') ||
      localStorage.getItem('srpk_hierarchy_estate_v3');
    if (!raw) return INITIAL_ESTATE_DATASET;
    const parsed = JSON.parse(raw) as EstateDataset;
    if (!Array.isArray(parsed?.properties) || !Array.isArray(parsed?.units)) {
      return INITIAL_ESTATE_DATASET;
    }
    return migrateDataset(parsed);
  } catch {
    return INITIAL_ESTATE_DATASET;
  }
}

/**
 * Recalculates any open (Unpaid / Partially Paid) invoices from current upstream
 * properties, units, tenants, building maintenance bills, utility readings, and prior arrears.
 * NEVER touches locked invoices (Partially Paid & Closed / Paid & Closed).
 */
function recalculateOpenInvoices(
  state: EstateDataset,
  filterFn: (inv: InvoiceRecord) => boolean
): { nextInvoices: InvoiceRecord[]; updatedInvoices: InvoiceRecord[] } {
  const updatedInvoices: InvoiceRecord[] = [];
  const nextInvoices = state.invoices.map((inv) => {
    if (inv.is_locked || isInvoiceLockedStatus(inv.payment_status)) {
      return inv;
    }
    if (!filterFn(inv)) return inv;

    const property = state.properties.find((p) => p.property_id === inv.property_id);
    const unit = state.units.find((u) => u.unit_id === inv.unit_id);
    const tenant = state.tenants.find((t) => t.id === inv.tenant_id);
    const reading = state.utilityReadings.find(
      (r) => r.unit_id === inv.unit_id && r.billing_month === inv.billing_month
    );
    const houseMaint = state.houseMaintenanceBills.find(
      (m) =>
        m.property_id === inv.property_id && m.billing_month === inv.billing_month
    );

    const rentAmount = tenant
      ? tenant.lease_type === 'Lease'
        ? 0
        : tenant.monthly_rent
      : inv.rent_amount;
    const tenantCleaningFee = tenant
      ? tenant.monthly_maintenance_charge
      : inv.tenant_cleaning_fee;
    const leaseType = tenant?.lease_type ?? inv.lease_type;

    const unitCount = state.units.filter(
      (u) => u.property_id === inv.property_id
    ).length;
    const bldgTotal = houseMaint?.total_house_maintenance ?? 0;
    const bldgShare =
      houseMaint && unitCount > 0 ? Math.round(bldgTotal / unitCount) : 0;
    const bldgItems = houseMaint
      ? [
          {
            name: `Common Motor Electricity (${property?.utility_provider || 'EB'})`,
            amount: houseMaint.common_eb_amount,
          },
          ...houseMaint.additional_charges.map((c) => ({
            name: c.charge_name,
            amount: c.charge_amount,
          })),
        ]
      : [];

    const waterRate = tenant?.water_charge ?? reading?.water_rate ?? inv.water_rate;
    const prev1 = reading?.prev_reading_1 ?? inv.water_prev_1;
    const curr1 = reading?.curr_reading_1 ?? inv.water_curr_1;
    const prev2 = reading?.prev_reading_2 ?? inv.water_prev_2;
    const curr2 = reading?.curr_reading_2 ?? inv.water_curr_2;
    const netUnits = reading?.net_consumption ?? inv.water_net_units;
    const waterAmount = reading
      ? Math.round(reading.net_consumption * waterRate)
      : Math.round(netUnits * waterRate);

    const ebAmount = reading?.eb_bill_amount ?? inv.eb_amount;
    const ebPaidToOwner = inv.eb_paid_to_owner;

    const priorInvoices = state.invoices
      .filter(
        (other) =>
          other.tenant_id === inv.tenant_id &&
          other.billing_month < inv.billing_month
      )
      .sort((a, b) => b.billing_month.localeCompare(a.billing_month));
    const latestPrior = priorInvoices[0];
    const carriedForward =
      latestPrior &&
      latestPrior.payment_status === 'Partially Paid & Closed' &&
      latestPrior.balance_due > 0
        ? latestPrior.balance_due
        : inv.carried_forward_balance;

    const totalBillValue =
      rentAmount +
      tenantCleaningFee +
      bldgShare +
      waterAmount +
      ebAmount +
      carriedForward;
    const totalPayableToOwner =
      rentAmount +
      tenantCleaningFee +
      bldgShare +
      waterAmount +
      (ebPaidToOwner ? ebAmount : 0) +
      carriedForward;

    const cappedPaid = Math.min(inv.amount_paid, totalPayableToOwner);
    const balanceDue = Math.max(0, totalPayableToOwner - cappedPaid);

    const motorFromMaint =
      houseMaint && unitCount > 0 ? Math.round(houseMaint.common_eb_amount / unitCount) : 0;
    const othersFromMaint = Math.max(0, bldgShare - motorFromMaint) + carriedForward;

    const recalced: InvoiceRecord = {
      ...inv,
      property_name: property?.property_name ?? inv.property_name,
      unit_name: unit?.unit_name ?? inv.unit_name,
      unit_type: unit?.unit_type ?? inv.unit_type,
      floor: unit?.floor ?? inv.floor,
      tenant_name: tenant?.full_name ?? inv.tenant_name,
      whatsapp_phone: tenant?.whatsapp_phone ?? inv.whatsapp_phone,
      lease_type: leaseType,
      rent_amount: rentAmount,
      tenant_cleaning_fee: tenantCleaningFee,
      building_maintenance_total: bldgTotal,
      building_unit_count: unitCount,
      building_maintenance_share: bldgShare,
      building_maintenance_items: bldgItems,
      eb_amount: ebAmount,
      water_prev_1: prev1,
      water_curr_1: curr1,
      water_prev_2: prev2,
      water_curr_2: curr2,
      water_net_units: netUnits,
      water_rate: waterRate,
      water_amount: waterAmount,
      carried_forward_balance: carriedForward,
      total_bill_value: totalBillValue,
      total_payable_to_owner: totalPayableToOwner,
      amount_paid: cappedPaid,
      balance_due: balanceDue,
      keb_account_id: inv.keb_account_id || unit?.eb_rr_number || '',
      water_reference:
        inv.water_reference ||
        buildDefaultWaterReference({
          waterRr1: unit?.water_rr_number,
          waterRr2: unit?.water_rr_number2,
          prev1,
          curr1,
          prev2,
          curr2,
        }),
      motor_bill_amount: houseMaint ? motorFromMaint : inv.motor_bill_amount ?? 0,
      others_amount: houseMaint ? othersFromMaint : inv.others_amount ?? carriedForward,
    };

    updatedInvoices.push(recalced);
    return recalced;
  });

  return { nextInvoices, updatedInvoices };
}

function parsePulledTables(
  tables: Record<SyncTable, Record<string, unknown>[]>,
  existingTenants: TenantRecord[]
): {
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  houseMaintenanceBills: HouseMaintenanceBill[];
  utilityReadings: UtilityReading[];
  invoices: InvoiceRecord[];
  expenses: ExpenseRecord[];
} {
  const properties: PropertyHouse[] = (tables.Properties || []).map((r) => ({
    property_id: String(r.property_id || r.recordId || ''),
    property_name: String(r.property_name || ''),
    address: String(r.address || ''),
    total_floors: toNum(r.total_floors, 1),
    common_eb_rr_number: String(r.common_eb_rr_number || ''),
    utility_provider: r.utility_provider === 'TNEB' ? 'TNEB' : 'BESCOM',
  }));

  const units: Unit[] = (tables.Units || []).map((r) => ({
    unit_id: String(r.unit_id || r.recordId || ''),
    property_id: String(r.property_id || ''),
    unit_name: String(r.unit_name || ''),
    unit_type: String(r.unit_type || ''),
    floor: String(r.floor || 'Ground Floor'),
    eb_rr_number: String(r.eb_rr_number || ''),
    water_rr_number: String(r.water_rr_number || ''),
    water_rr_number2: r.water_rr_number2 ? String(r.water_rr_number2) : undefined,
    status: r.status === 'OCCUPIED' ? 'OCCUPIED' : 'VACANT',
    current_tenant_id: r.current_tenant_id ? String(r.current_tenant_id) : null,
    last_water_reading_1: toNum(r.last_water_reading_1, 0),
    last_water_reading_2: toNum(r.last_water_reading_2, 0),
  }));

  const existingTenantsById = new Map<string, TenantRecord>(
    existingTenants.map((t) => [t.id, t])
  );

  const tenants: TenantRecord[] = (tables.Tenants || []).map((raw) => {
    const migrated = migrateTenantRecord(raw);
    const prevTenant = existingTenantsById.get(migrated.id);
    if (
      prevTenant?.agreement_file?.data_url &&
      migrated.agreement_file &&
      !migrated.agreement_file.data_url &&
      prevTenant.agreement_file.name === migrated.agreement_file.name
    ) {
      migrated.agreement_file = {
        ...migrated.agreement_file,
        data_url: prevTenant.agreement_file.data_url,
      };
    }
    return migrated;
  });

  const houseMaintenanceBills: HouseMaintenanceBill[] = (
    tables.BuildingMaintenance || []
  ).map((r) => {
    let charges = Array.isArray(r.additional_charges) ? r.additional_charges : [];
    if (typeof r.additional_charges === 'string' && r.additional_charges.startsWith('[')) {
      try {
        charges = JSON.parse(r.additional_charges);
      } catch {
        charges = [];
      }
    }
    return {
      id: String(r.id || r.recordId || ''),
      property_id: String(r.property_id || ''),
      billing_month: String(r.billing_month || ''),
      common_eb_amount: toNum(r.common_eb_amount, 0),
      additional_charges: charges as HouseMaintenanceBill['additional_charges'],
      total_house_maintenance: toNum(r.total_house_maintenance, 0),
      updated_at: String(r.updated_at || new Date().toISOString()),
    };
  });

  const utilityReadings: UtilityReading[] = (tables.UtilityReadings || []).map((r) => ({
    id: String(r.id || r.recordId || ''),
    property_id: String(r.property_id || ''),
    unit_id: String(r.unit_id || ''),
    billing_month: String(r.billing_month || ''),
    eb_bill_amount: toNum(r.eb_bill_amount, 0),
    eb_paid_to_owner: toBool(r.eb_paid_to_owner, true),
    prev_reading_1: toNum(r.prev_reading_1, 0),
    curr_reading_1: toNum(r.curr_reading_1, 0),
    prev_reading_2: toNum(r.prev_reading_2, 0),
    curr_reading_2: toNum(r.curr_reading_2, 0),
    net_consumption: toNum(r.net_consumption, 0),
    water_rate: toNum(r.water_rate, 45),
    water_bill_amount: toNum(r.water_bill_amount, 0),
    captured_at: String(r.captured_at || new Date().toISOString()),
  }));

  const invoices: InvoiceRecord[] = (tables.Invoices || []).map((raw) =>
    migrateInvoiceRecord(raw)
  );

  const expenses: ExpenseRecord[] = (tables.Expenses || []).map((raw) =>
    migrateExpenseRecord(raw)
  );

  return {
    properties,
    units,
    tenants,
    houseMaintenanceBills,
    utilityReadings,
    invoices,
    expenses,
  };
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(loadPersistedAuthSession);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const [autoLockTimer, setAutoLockTimer] = useState<AutoLockTimerMode>(() =>
    loadAutoLockTimerMode()
  );
  const [dataset, setDataset] = useState<EstateDataset>(loadLocalDataset);
  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [billingMonth, setBillingMonth] = useState<string>('2026-11');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('ALL');

  // Biometric post-login enrollment prompt state
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [showBiometricPrompt, setShowBiometricPrompt] = useState(false);
  const [biometricPromptFeedback, setBiometricPromptFeedback] = useState<string | null>(
    null
  );

  // Contextual navigation triggers
  const [meterUnitId, setMeterUnitId] = useState<string | null>(null);
  const [maintPropertyId, setMaintPropertyId] = useState<string | null>(null);
  const [onboardUnitId, setOnboardUnitId] = useState<string | null>(null);
  const [moveOutUnitId, setMoveOutUnitId] = useState<string | null>(null);

  // Silent Google Sheets Service Account Sync State (zero credentials exposed in UI)
  const [secretConfigured, setSecretConfigured] = useState<boolean>(false);
  const [syncDiagnostics, setSyncDiagnostics] = useState<SyncDiagnostics | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('Synced');
  const [isPulling, setIsPulling] = useState(false);
  const [isPushingAll, setIsPushingAll] = useState(false);
  const [pullFeedback, setPullFeedback] = useState<string | null>(null);
  const [showSeedEmptySheetModal, setShowSeedEmptySheetModal] = useState(false);

  // Settings, Install Hub, Browser Notifications
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );

  const hydratedFromServer = useRef(false);
  const skipNextServerPut = useRef(false);
  const datasetRef = useRef(dataset);
  datasetRef.current = dataset;

  // 1. Pull directly from Google Sheet via silent Service Account authentication
  const handlePullFromSheets = useCallback(
    async (options?: { silentOnFailureOrEmpty?: boolean }) => {
      const silent = Boolean(options?.silentOnFailureOrEmpty);

      setIsPulling(true);
      if (!silent) {
        setPullFeedback(null);
      }
      setSyncStatus('Syncing...');

      const res = await pullAllFromGoogleSheet();
      if (res.diagnostics) {
        setSyncDiagnostics(res.diagnostics);
      } else {
        setSyncDiagnostics({
          connected: res.ok,
          authMode: res.mode,
          httpStatus: res.httpStatus ?? (res.ok ? 200 : 403),
          tokenStatus: res.ok ? 'Active' : 'Auth Required',
          message: res.error || 'Could not read Google Sheet.',
          testedAt: new Date().toISOString(),
          tabStatuses: res.tabStatuses,
        });
      }

      if (!res.ok || !res.data || res.existingTabsCount === 0) {
        setSyncStatus('Offline/Error');
        if (!silent) {
          setPullFeedback(
            res.error ||
              'Could not pull from Google Sheet. Check Sync Diagnostics in Settings.'
          );
        }
        setIsPulling(false);
        return res;
      }

      // Avoid wiping local data if tabs exist in Google Sheet with 0 data rows
      if (res.totalRowCount === 0) {
        setSyncStatus('Synced');
        if (!silent) {
          setShowSeedEmptySheetModal(true);
          setPullFeedback(
            `Connected to Google Sheet (${SPREADSHEET_ID}), all ${res.existingTabsCount} tabs currently have 0 rows. Local data preserved.`
          );
        }
        setIsPulling(false);
        return res;
      }

      const pulled = parsePulledTables(res.data, datasetRef.current.tenants);

      // Completely replace stale local data with live Google Sheet rows
      setDataset((prev) => ({
        ...pulled,
        settings: {
          ...prev.settings,
          last_synced_at: new Date().toISOString(),
        },
      }));

      setSyncStatus('Synced');
      setPullFeedback(
        `Synced from Google Sheet: ${pulled.properties.length} properties, ${pulled.units.length} units, ${pulled.tenants.length} tenants, ${pulled.invoices.length} invoices.`
      );
      setIsPulling(false);
      return res;
    },
    []
  );

  const lockApp = useCallback((noticeMessage: string) => {
    savePersistedAuthSession(null);
    setSession(null);
    setShowSettingsModal(false);
    setShowInstallModal(false);
    setShowBiometricPrompt(false);
    setBiometricPromptFeedback(null);
    setActiveView('dashboard');
    setLockNotice(noticeMessage);
  }, []);

  // 2. Hydrate from server-side /api/estate, fetch Sheets status, then Auto-Pull when authenticated
  const fetchServerDataset = useCallback(
    async (authToken?: string) => {
      if (!authToken) return;
      try {
        const res = await fetch('/api/estate', {
          headers: getAuthFetchHeaders(authToken),
        });
        if (res.status === 401 || res.status === 403) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          lockApp(errBody.error || 'Session expired or access revoked.');
          return;
        }
        const payload = res.ok ? await res.json() : null;
        if (
          payload?.exists &&
          Array.isArray(payload.data?.properties) &&
          Array.isArray(payload.data?.units)
        ) {
          skipNextServerPut.current = true;
          setDataset(migrateDataset(payload.data as EstateDataset));
        }
      } catch {
        // keep local dataset
      } finally {
        hydratedFromServer.current = true;
      }
    },
    [lockApp]
  );

  useEffect(() => {
    try {
      localStorage.removeItem('srpk_service_account_json');
    } catch {
      // ignore storage cleanup errors
    }
    void isPlatformBiometricSupported().then(setBiometricSupported);
  }, []);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      await fetchServerDataset(session.authToken);
      if (session.accessType === 'admin' || session.accessType === 'viewer') {
        const status = await fetchSheetsConfigStatus();
        setSecretConfigured(status.secretConfigured);
        await handlePullFromSheets({ silentOnFailureOrEmpty: true });
      }
    })();
  }, [session, fetchServerDataset, handlePullFromSheets]);

  const handleAuthenticated = async (nextSession: AuthSession) => {
    setLockNotice(null);
    savePersistedAuthSession(nextSession);
    setSession(nextSession);
    setBiometricPromptFeedback(null);

    if (nextSession.loginMethod === 'password') {
      const supported = await isPlatformBiometricSupported();
      setBiometricSupported(supported);
      if (supported && !isBiometricEnrolledForUser(nextSession.userId)) {
        setShowBiometricPrompt(true);
      }
    } else {
      setShowBiometricPrompt(false);
    }
  };

  const handleChangeAutoLockTimer = useCallback((mode: AutoLockTimerMode) => {
    saveAutoLockTimerMode(mode);
    setAutoLockTimer(mode);
    setDataset((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        auto_lock_timer: mode,
      },
    }));
  }, []);

  // Automatic Session Timeout (15s check) + Background/Re-Launch Lock (visibilitychange & focus)
  useEffect(() => {
    if (!session) return;

    recordLastActivityTimestamp(Date.now());
    let lastRecordedMs = Date.now();

    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastRecordedMs >= 1000) {
        lastRecordedMs = now;
        recordLastActivityTimestamp(now);
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'click',
      'touchstart',
      'mousemove',
      'keydown',
      'scroll',
    ];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, handleUserActivity, { passive: true });
    });

    const intervalId = window.setInterval(() => {
      const check = evaluateSessionLockStatus(autoLockTimer);
      if (check.locked) {
        lockApp(check.reason || 'Session locked due to inactivity.');
      }
    }, 15000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'hidden') {
        recordHiddenAtTimestamp(Date.now());
        if (autoLockTimer === 'immediate') {
          lockApp('App locked when moved to background.');
        }
        return;
      }

      const check = evaluateSessionLockStatus(autoLockTimer);
      if (check.locked) {
        lockApp(
          check.reason || 'Session locked for security after leaving the app.'
        );
      } else {
        clearHiddenAtTimestamp();
        const now = Date.now();
        lastRecordedMs = now;
        recordLastActivityTimestamp(now);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, handleUserActivity);
      });
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [session, autoLockTimer, lockApp]);

  const handleEnableBiometricPrompt = async () => {
    if (!session) return;
    setBiometricPromptFeedback(null);
    const res = await registerPlatformBiometric(session.userId, session.fullName);
    if (res.ok) {
      setShowBiometricPrompt(false);
      setPullFeedback(
        `Biometric Quick Login enabled for ${session.fullName} on this device.`
      );
    } else {
      setBiometricPromptFeedback(
        'error' in res ? res.error : 'Biometric enrollment failed.'
      );
    }
  };

  // 3. Persist changes to localStorage AND server /api/estate (Admin writes only)
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dataset));
    } catch {
      // ignore storage quota errors
    }

    if (!hydratedFromServer.current) return;
    if (skipNextServerPut.current) {
      skipNextServerPut.current = false;
      return;
    }
    if (session?.accessType !== 'admin' || !session.authToken) return;

    fetch('/api/estate', {
      method: 'PUT',
      headers: getAuthFetchHeaders(session.authToken, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(dataset),
    }).catch(() => {
      // keep local copy if server unreachable
    });
  }, [dataset, session?.accessType, session?.authToken]);

  // 4. Monthly Automated Browser Push Notification for Tenure Expiring Soon (<= 4 months)
  const dispatchTenureBrowserNotification = useCallback(
    (tenantsList: TenantRecord[], propertiesList: PropertyHouse[], unitsList: Unit[]) => {
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;

      const currentMonthKey = new Date().toISOString().slice(0, 7);
      const sentKey = 'srpk_tenure_notif_sent_month';
      try {
        if (localStorage.getItem(sentKey) === currentMonthKey) return;
      } catch {
        // ignore storage errors
      }

      const expiring = tenantsList.filter((t) => {
        if (!t.is_active) return false;
        const endDate =
          t.lease_end_date ||
          calculateLeaseEndDate(t.move_in_date, t.tenure_months || 11);
        return getTenureRemainingInfo(endDate).isExpiringSoon;
      });

      if (expiring.length === 0) return;

      const summary = expiring
        .slice(0, 3)
        .map((t) => {
          const p = propertiesList.find((prop) => prop.property_id === t.property_id);
          const u = unitsList.find((unit) => unit.unit_id === t.unit_id);
          const info = getTenureRemainingInfo(t.lease_end_date);
          return `${t.full_name} (${p?.property_name || ''} ${u?.unit_name || ''}: ${info.label})`;
        })
        .join(', ');

      try {
        new Notification('Tenure Expiring Soon — SRKP Rental Tool', {
          body: `${expiring.length} tenant(s) in final 4 months: ${summary}`,
        });
        localStorage.setItem(sentKey, currentMonthKey);
      } catch {
        // ignore notification API errors in restricted contexts
      }
    },
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      dispatchTenureBrowserNotification(
        dataset.tenants,
        dataset.properties,
        dataset.units
      );
    } else if (Notification.permission === 'default') {
      const hasExpiring = dataset.tenants.some((t) => {
        if (!t.is_active) return false;
        return getTenureRemainingInfo(
          t.lease_end_date || calculateLeaseEndDate(t.move_in_date, t.tenure_months || 11)
        ).isExpiringSoon;
      });
      if (hasExpiring) {
        Notification.requestPermission()
          .then((perm) => {
            setNotificationPermission(perm);
            if (perm === 'granted') {
              dispatchTenureBrowserNotification(
                dataset.tenants,
                dataset.properties,
                dataset.units
              );
            }
          })
          .catch(() => {
            // browser blocked automatic prompt without user gesture
          });
      }
    }
  }, [dataset.tenants.length, dispatchTenureBrowserNotification]);

  const handleRequestBrowserNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setNotificationPermission(perm);
      if (perm === 'granted') {
        localStorage.removeItem('srpk_tenure_notif_sent_month');
        dispatchTenureBrowserNotification(
          dataset.tenants,
          dataset.properties,
          dataset.units
        );
      }
    } catch {
      // ignore
    }
  };

  // 5. Server-Managed Service Account Test, Push & Live Auto-Sync
  const handleTestConnectionAndSync = async () => {
    setIsTestingConnection(true);
    setSyncStatus('Syncing...');
    setPullFeedback(null);

    const result = await testConnectionAndSyncNow(datasetRef.current);
    setSyncDiagnostics(result.diagnostics);

    if (result.action === 'pulled' && result.pulledData) {
      const pulled = parsePulledTables(result.pulledData, datasetRef.current.tenants);
      setDataset((prev) => ({
        ...pulled,
        settings: {
          ...prev.settings,
          last_synced_at: new Date().toISOString(),
        },
      }));
      setSyncStatus('Synced');
      setPullFeedback(result.diagnostics.message);
    } else if (result.action === 'initialized_sheet') {
      setSyncStatus('Synced');
      setDataset((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          last_synced_at: new Date().toISOString(),
        },
      }));
      setPullFeedback(result.diagnostics.message);
    } else {
      setSyncStatus('Offline/Error');
      setPullFeedback(result.diagnostics.message);
    }

    setIsTestingConnection(false);
  };

  const handlePushAllToSheets = async () => {
    if (session?.accessType !== 'admin') return;
    setIsPushingAll(true);
    setSyncStatus('Syncing...');

    const res = await pushAllTablesToGoogleSheet(datasetRef.current);
    if (res.diagnostics) {
      setSyncDiagnostics(res.diagnostics);
    } else {
      setSyncDiagnostics({
        connected: res.ok,
        authMode: res.ok ? 'service_account' : 'none',
        httpStatus: res.httpStatus || (res.ok ? 200 : 403),
        tokenStatus: res.ok ? 'Active' : 'Auth Required',
        message: res.ok
          ? `Pushed all ${REQUIRED_SHEET_TABS.length} tables to Google Sheet (${SPREADSHEET_ID}).`
          : res.error || 'Failed to push all tables to Google Sheet.',
        testedAt: new Date().toISOString(),
        tabStatuses: res.tabStatuses,
      });
    }

    if (res.ok) {
      setSyncStatus('Synced');
      setDataset((prev) => ({
        ...prev,
        settings: { ...prev.settings, last_synced_at: new Date().toISOString() },
      }));
      setPullFeedback(
        `Synced all ${REQUIRED_SHEET_TABS.length} tables to Google Sheet (${SPREADSHEET_ID})${
          res.createdTabs.length > 0
            ? ` and auto-created: ${res.createdTabs.join(', ')}`
            : ''
        }.`
      );
    } else {
      setSyncStatus('Offline/Error');
      setPullFeedback(res.error || 'Failed to push all tables to Google Sheet.');
    }
    setIsPushingAll(false);
  };

  // Direct Sheets API v4 Live Table Auto-Push Helper
  const syncTableDirect = useCallback(async (table: SyncTable, rows: unknown[]) => {
    if (session?.accessType !== 'admin') return;
    setSyncStatus('Syncing...');
    const res = await syncTableToGoogleSheet(table, rows);
    if (res.ok) {
      setSyncStatus('Synced');
      setDataset((prev) => ({
        ...prev,
        settings: { ...prev.settings, last_synced_at: new Date().toISOString() },
      }));
    } else {
      setSyncStatus('Offline/Error');
      setSyncDiagnostics({
        connected: false,
        authMode: res.authMode || 'none',
        httpStatus: res.httpStatus || 403,
        tokenStatus: res.tokenStatus || 'Auth Required',
        message: res.error || `Failed to auto-sync ${table} to Google Sheet.`,
        testedAt: new Date().toISOString(),
        tabStatuses: REQUIRED_SHEET_TABS.map((t) => ({
          tab: t,
          ok: t !== table,
          httpStatus: t === table ? res.httpStatus : undefined,
        })),
      });
      setPullFeedback(res.error || `Failed to auto-sync ${table} to Google Sheet.`);
    }
  }, [session?.accessType]);

  // OLTP Mutation Handlers — Properties (Houses)
  const handleSaveProperty = (property: PropertyHouse, isNew: boolean) => {
    const nextProperties = isNew
      ? [...datasetRef.current.properties, property]
      : datasetRef.current.properties.map((p) =>
          p.property_id === property.property_id ? property : p
        );

    setDataset((prev) => ({
      ...prev,
      properties: nextProperties,
    }));
    void syncTableDirect('Properties', nextProperties);
  };

  const handleDeleteProperty = (propertyId: string) => {
    const nextProperties = datasetRef.current.properties.filter(
      (p) => p.property_id !== propertyId
    );
    setDataset((prev) => ({
      ...prev,
      properties: nextProperties,
    }));
    if (selectedPropertyId === propertyId) {
      setSelectedPropertyId('ALL');
    }
    void syncTableDirect('Properties', nextProperties);
  };

  // OLTP Mutation Handlers — Child Units (Auto-recalculates open invoices if unit count changes)
  const handleSaveUnit = (unit: Unit, isNew: boolean) => {
    const prevState = datasetRef.current;
    const nextUnits = isNew
      ? [...prevState.units, unit]
      : prevState.units.map((u) => (u.unit_id === unit.unit_id ? unit : u));
    const tempState = { ...prevState, units: nextUnits };
    const { nextInvoices, updatedInvoices } = recalculateOpenInvoices(
      tempState,
      (inv) => inv.property_id === unit.property_id
    );

    setDataset({ ...tempState, invoices: nextInvoices });

    void (async () => {
      await syncTableDirect('Units', nextUnits);
      if (updatedInvoices.length > 0) {
        await syncTableDirect('Invoices', nextInvoices);
      }
    })();
  };

  const handleDeleteUnit = (unitId: string) => {
    const prevState = datasetRef.current;
    const existing = prevState.units.find((u) => u.unit_id === unitId);
    const nextUnits = prevState.units.filter((u) => u.unit_id !== unitId);
    const tempState = { ...prevState, units: nextUnits };
    const { nextInvoices, updatedInvoices } = recalculateOpenInvoices(
      tempState,
      (inv) => Boolean(existing && inv.property_id === existing.property_id)
    );

    setDataset({ ...tempState, invoices: nextInvoices });

    void (async () => {
      await syncTableDirect('Units', nextUnits);
      if (updatedInvoices.length > 0) {
        await syncTableDirect('Invoices', nextInvoices);
      }
    })();
  };

  // OLTP Mutation Handlers — Tenant Onboarding, Profile Edits & Move-Out
  const handleCompleteOnboarding = (payload: {
    tenant: TenantRecord;
    unitUpdate: Unit;
  }) => {
    const prevState = datasetRef.current;
    const nextTenants = [payload.tenant, ...prevState.tenants];
    const nextUnits = prevState.units.map((u) =>
      u.unit_id === payload.unitUpdate.unit_id ? payload.unitUpdate : u
    );

    setDataset((prev) => ({
      ...prev,
      tenants: nextTenants,
      units: nextUnits,
    }));

    void (async () => {
      await syncTableDirect('Tenants', nextTenants);
      await syncTableDirect('Units', nextUnits);
      setPullFeedback(
        `${payload.tenant.full_name} onboarded to unit ${payload.unitUpdate.unit_name}.`
      );
    })();
  };

  const handleUpdateTenant = (updatedTenant: TenantRecord) => {
    const prevState = datasetRef.current;
    const nextTenants = prevState.tenants.map((t) =>
      t.id === updatedTenant.id ? updatedTenant : t
    );
    const tempState = { ...prevState, tenants: nextTenants };
    const { nextInvoices, updatedInvoices } = recalculateOpenInvoices(
      tempState,
      (inv) => inv.tenant_id === updatedTenant.id
    );

    setDataset({ ...tempState, invoices: nextInvoices });

    void (async () => {
      await syncTableDirect('Tenants', nextTenants);
      if (updatedInvoices.length > 0) {
        await syncTableDirect('Invoices', nextInvoices);
      }
    })();
  };

  const handleCompleteMoveOut = (payload: {
    tenantId: string;
    unitId: string;
    move_out_date: string;
    deductions: DeductionRow[];
    final_refundable_amount: number;
  }) => {
    const prevState = datasetRef.current;
    const targetTenant = prevState.tenants.find((t) => t.id === payload.tenantId);
    const nextTenants = prevState.tenants.map((t) =>
      t.id === payload.tenantId
        ? {
            ...t,
            is_active: false,
            move_out_date: payload.move_out_date,
            deductions: payload.deductions,
            final_refundable_amount: payload.final_refundable_amount,
          }
        : t
    );
    const nextUnits = prevState.units.map((u) =>
      u.unit_id === payload.unitId
        ? { ...u, status: 'VACANT' as const, current_tenant_id: null }
        : u
    );

    setDataset((prev) => ({
      ...prev,
      tenants: nextTenants,
      units: nextUnits,
    }));

    void (async () => {
      await syncTableDirect('Tenants', nextTenants);
      await syncTableDirect('Units', nextUnits);
      setPullFeedback(
        `${targetTenant?.full_name || 'Tenant'} moved out and unit marked VACANT.`
      );
    })();
  };

  // OLTP Mutation Handlers — Building Maintenance
  const handleSaveHouseMaintenanceBill = (
    bill: HouseMaintenanceBill,
    isEdit: boolean
  ) => {
    const prevState = datasetRef.current;
    const nextBills = isEdit
      ? prevState.houseMaintenanceBills.map((m) => (m.id === bill.id ? bill : m))
      : [bill, ...prevState.houseMaintenanceBills];
    const tempState = { ...prevState, houseMaintenanceBills: nextBills };
    const { nextInvoices, updatedInvoices } = recalculateOpenInvoices(
      tempState,
      (inv) =>
        inv.property_id === bill.property_id &&
        inv.billing_month === bill.billing_month
    );

    setDataset({ ...tempState, invoices: nextInvoices });

    void (async () => {
      await syncTableDirect('BuildingMaintenance', nextBills);
      if (updatedInvoices.length > 0) {
        await syncTableDirect('Invoices', nextInvoices);
      }
    })();
  };

  // OLTP Mutation Handlers — Utility Meter Readings & EB
  const handleSaveUtilityReading = (reading: UtilityReading, isNew: boolean) => {
    const prevState = datasetRef.current;
    const nextUnits = prevState.units.map((u) =>
      u.unit_id === reading.unit_id
        ? {
            ...u,
            last_water_reading_1: reading.curr_reading_1,
            last_water_reading_2: reading.curr_reading_2,
          }
        : u
    );
    const nextReadings = isNew
      ? [reading, ...prevState.utilityReadings]
      : prevState.utilityReadings.map((r) => (r.id === reading.id ? reading : r));

    const tempState = {
      ...prevState,
      units: nextUnits,
      utilityReadings: nextReadings,
    };
    const { nextInvoices, updatedInvoices } = recalculateOpenInvoices(
      tempState,
      (inv) =>
        inv.unit_id === reading.unit_id &&
        inv.billing_month === reading.billing_month
    );

    setDataset({ ...tempState, invoices: nextInvoices });

    void (async () => {
      await syncTableDirect('UtilityReadings', nextReadings);
      await syncTableDirect('Units', nextUnits);
      if (updatedInvoices.length > 0) {
        await syncTableDirect('Invoices', nextInvoices);
      }
    })();
  };

  const handleSaveUtilityReadingsBatch = (readings: UtilityReading[]) => {
    if (readings.length === 0) return;
    const prevState = datasetRef.current;
    const readingByUnitId = new Map<string, UtilityReading>();
    readings.forEach((r) => readingByUnitId.set(r.unit_id, r));

    const nextUnits = prevState.units.map((u) => {
      const r = readingByUnitId.get(u.unit_id);
      if (!r) return u;
      return {
        ...u,
        last_water_reading_1: r.curr_reading_1,
        last_water_reading_2: r.curr_reading_2,
      };
    });

    const replacedKeys = new Set(
      readings.map((r) => `${r.unit_id}::${r.billing_month}`)
    );
    const retainedReadings = prevState.utilityReadings.filter(
      (r) => !replacedKeys.has(`${r.unit_id}::${r.billing_month}`)
    );
    const nextReadings = [...readings, ...retainedReadings];

    const tempState = {
      ...prevState,
      units: nextUnits,
      utilityReadings: nextReadings,
    };
    const { nextInvoices, updatedInvoices } = recalculateOpenInvoices(
      tempState,
      (inv) => replacedKeys.has(`${inv.unit_id}::${inv.billing_month}`)
    );

    setDataset({ ...tempState, invoices: nextInvoices });

    void (async () => {
      await syncTableDirect('UtilityReadings', nextReadings);
      await syncTableDirect('Units', nextUnits);
      if (updatedInvoices.length > 0) {
        await syncTableDirect('Invoices', nextInvoices);
      }
    })();
  };

  // OLTP Mutation Handlers — Invoices
  const handleCreateInvoice = (invoice: InvoiceRecord) => {
    const nextInvoices = [invoice, ...datasetRef.current.invoices];
    setDataset((prev) => ({
      ...prev,
      invoices: nextInvoices,
    }));
    void syncTableDirect('Invoices', nextInvoices);
  };

  const handleUpdateInvoice = (updatedInvoice: InvoiceRecord) => {
    const prevState = datasetRef.current;
    const nextInvoicesRaw = prevState.invoices.map((inv) =>
      inv.id === updatedInvoice.id ? updatedInvoice : inv
    );
    const tempState = { ...prevState, invoices: nextInvoicesRaw };
    const { nextInvoices } = recalculateOpenInvoices(
      tempState,
      (inv) =>
        inv.tenant_id === updatedInvoice.tenant_id &&
        inv.billing_month > updatedInvoice.billing_month
    );

    setDataset({ ...tempState, invoices: nextInvoices });
    void syncTableDirect('Invoices', nextInvoices);
  };

  // OLTP Mutation Handlers — Expenses
  const handleAddExpensesBatch = (newExpenses: ExpenseRecord[]) => {
    const nextExpenses = [...newExpenses, ...(datasetRef.current.expenses || [])];
    setDataset((prev) => ({
      ...prev,
      expenses: nextExpenses,
    }));
    void syncTableDirect('Expenses', nextExpenses);
  };

  const handleUpdateExpense = (updated: ExpenseRecord) => {
    const nextExpenses = (datasetRef.current.expenses || []).map((exp) =>
      exp.id === updated.id ? updated : exp
    );
    setDataset((prev) => ({
      ...prev,
      expenses: nextExpenses,
    }));
    void syncTableDirect('Expenses', nextExpenses);
  };

  const handleDeleteExpense = (expenseId: string) => {
    const nextExpenses = (datasetRef.current.expenses || []).filter(
      (exp) => exp.id !== expenseId
    );
    setDataset((prev) => ({
      ...prev,
      expenses: nextExpenses,
    }));
    void syncTableDirect('Expenses', nextExpenses);
  };

  const handleSaveSettings = (nextSettings: AppSettings) => {
    if (isValidAutoLockMode(nextSettings.auto_lock_timer)) {
      saveAutoLockTimerMode(nextSettings.auto_lock_timer);
      setAutoLockTimer(nextSettings.auto_lock_timer);
    }
    setDataset((prev) => ({
      ...prev,
      settings: nextSettings,
    }));
  };

  const handleResetBaseline = () => {
    setDataset((prev) => ({
      ...INITIAL_ESTATE_DATASET,
      settings: prev.settings,
    }));
    setSelectedPropertyId('ALL');
    setPullFeedback('Restored initial Property -> Units estate baseline.');
  };

  const pendingInvoiceCount = useMemo(
    () =>
      dataset.invoices.filter(
        (inv) =>
          inv.billing_month === billingMonth &&
          (inv.payment_status === 'Unpaid' || inv.payment_status === 'Partially Paid')
      ).length,
    [dataset.invoices, billingMonth]
  );

  if (!session) {
    return (
      <LoginGate
        lockNotice={lockNotice}
        onDismissNotice={() => setLockNotice(null)}
        onAuthenticated={(nextSession) => void handleAuthenticated(nextSession)}
      />
    );
  }

  const isReadOnly = session.accessType === 'viewer';
  const senderSignature = session.fullName
    ? `${session.fullName}, House Owner`
    : 'SRKP Rental Management';

  return (
    <div className="min-h-screen w-full max-w-md mx-auto bg-gray-50 shadow-xl relative overflow-x-hidden text-[#0f172a] print:max-w-none print:bg-white print:shadow-none print:overflow-visible">
      {/* Post-Login Biometric Enrollment Prompt */}
      {showBiometricPrompt && biometricSupported && (
        <div className="mx-3 mt-3 rounded-2xl border border-[#489E44]/30 bg-white px-3.5 py-3 shadow-sm space-y-2.5 print:hidden">
          <div className="flex items-start gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#3E8E41]">
              <Fingerprint className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-[#0f172a]">
                Enable Fingerprint / Face ID Quick Login
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Sign in as {session.fullName || session.username} with one tap next time.
              </p>
              {biometricPromptFeedback && (
                <p className="text-[11px] font-semibold text-rose-700 mt-1">
                  {biometricPromptFeedback}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowBiometricPrompt(false)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer"
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => void handleEnableBiometricPrompt()}
              className="inline-flex items-center gap-1 rounded-xl bg-[#489E44] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#3E8E41] cursor-pointer"
            >
              <Fingerprint className="w-3.5 h-3.5" />
              <span>Enable</span>
            </button>
          </div>
        </div>
      )}

      {/* Compact Sync Notification Banner */}
      {pullFeedback && !showSettingsModal && (
        <div className="mx-3 mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-[#3E8E41] print:hidden">
          <span className="min-w-0 flex-1 break-words">{pullFeedback}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={SPREADSHEET_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[10px] font-bold text-[#3E8E41] hover:bg-emerald-50"
            >
              <span>Sheet</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <button
              type="button"
              onClick={() => setPullFeedback(null)}
              className="p-1 rounded-lg hover:bg-emerald-100 cursor-pointer"
              aria-label="Dismiss sync notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Active Screen Canvas */}
      <main className="w-full min-w-0 print:p-0">
        {activeView === 'dashboard' && (
          <MasterDashboard
            session={session}
            properties={dataset.properties}
            units={dataset.units}
            tenants={dataset.tenants}
            houseMaintenanceBills={dataset.houseMaintenanceBills}
            utilityReadings={dataset.utilityReadings}
            invoices={dataset.invoices}
            billingMonth={billingMonth}
            selectedPropertyId={selectedPropertyId}
            ownerWhatsappPhone={dataset.settings.owner_whatsapp_phone}
            notificationPermission={notificationPermission}
            onRequestBrowserNotifications={() => void handleRequestBrowserNotifications()}
            onChangeSelectedPropertyId={setSelectedPropertyId}
            onOpenProperties={() => setActiveView('properties')}
            onOpenUnits={() => setActiveView('units')}
            onOpenTenants={() => setActiveView('tenants')}
            onOpenInvoices={() => setActiveView('invoices')}
            onOpenMeters={() => {
              setMeterUnitId(null);
              setActiveView('meters');
            }}
            onOpenMetersForUnit={(unitId) => {
              setMeterUnitId(unitId);
              setActiveView('meters');
            }}
            onOpenMaintenance={() => {
              setMaintPropertyId(null);
              setActiveView('maintenance');
            }}
            onOpenExpenses={() => setActiveView('expenses')}
            onOpenAnnouncements={() => setActiveView('announcements')}
            onOpenSettings={() => {
              if (!isReadOnly) setShowSettingsModal(true);
            }}
            onOpenProfile={() => setActiveView('profile')}
            onPullFromSheets={() => void handlePullFromSheets()}
            isPulling={isPulling}
            onQuickLock={() => lockApp('App locked.')}
            onOpenOnboardUnit={(unitId) => {
              if (isReadOnly) return;
              setOnboardUnitId(unitId ?? null);
              setActiveView('tenants');
            }}
            onOpenMoveOutUnit={(unitId) => {
              if (isReadOnly) return;
              setMoveOutUnitId(unitId);
              setActiveView('tenants');
            }}
            isReadOnly={isReadOnly}
            senderSignature={senderSignature}
          />
        )}

        {(activeView === 'properties' || activeView === 'units') && (
          <UnitsManagementView
            properties={dataset.properties}
            units={dataset.units}
            tenants={dataset.tenants}
            selectedPropertyId={selectedPropertyId}
            initialTab={activeView === 'units' ? 'units' : 'properties'}
            onBack={() => setActiveView('dashboard')}
            onChangeSelectedPropertyId={setSelectedPropertyId}
            onSaveProperty={handleSaveProperty}
            onDeleteProperty={handleDeleteProperty}
            onSaveUnit={handleSaveUnit}
            onDeleteUnit={handleDeleteUnit}
            isReadOnly={isReadOnly}
          />
        )}

        {activeView === 'tenants' && (
          <TenantLifecycleView
            properties={dataset.properties}
            units={dataset.units}
            tenants={dataset.tenants}
            invoices={dataset.invoices}
            ownerWhatsappPhone={dataset.settings.owner_whatsapp_phone}
            selectedPropertyId={selectedPropertyId}
            onBack={() => setActiveView('dashboard')}
            onChangeSelectedPropertyId={setSelectedPropertyId}
            initialOnboardUnitId={onboardUnitId}
            initialMoveOutUnitId={moveOutUnitId}
            onClearInitialTriggers={() => {
              setOnboardUnitId(null);
              setMoveOutUnitId(null);
            }}
            onCompleteOnboarding={handleCompleteOnboarding}
            onUpdateTenant={handleUpdateTenant}
            onCompleteMoveOut={handleCompleteMoveOut}
            authToken={session.authToken}
            isReadOnly={isReadOnly}
            senderSignature={senderSignature}
          />
        )}

        {activeView === 'maintenance' && (
          <MaintenanceView
            properties={dataset.properties}
            units={dataset.units}
            houseMaintenanceBills={dataset.houseMaintenanceBills}
            billingMonth={billingMonth}
            initialPropertyId={maintPropertyId}
            onBack={() => setActiveView('dashboard')}
            onChangeBillingMonth={setBillingMonth}
            onSaveHouseMaintenanceBill={handleSaveHouseMaintenanceBill}
            isReadOnly={isReadOnly}
          />
        )}

        {activeView === 'meters' && (
          <UtilityMeterCapture
            properties={dataset.properties}
            units={dataset.units}
            tenants={dataset.tenants}
            utilityReadings={dataset.utilityReadings}
            billingMonth={billingMonth}
            selectedPropertyId={selectedPropertyId}
            onBack={() => setActiveView('dashboard')}
            onChangeBillingMonth={setBillingMonth}
            onChangeSelectedPropertyId={setSelectedPropertyId}
            initialUnitId={meterUnitId}
            onSaveUtilityReading={handleSaveUtilityReading}
            onSaveUtilityReadingsBatch={handleSaveUtilityReadingsBatch}
            isReadOnly={isReadOnly}
          />
        )}

        {activeView === 'invoices' && (
          <InvoicesView
            properties={dataset.properties}
            units={dataset.units}
            tenants={dataset.tenants}
            houseMaintenanceBills={dataset.houseMaintenanceBills}
            utilityReadings={dataset.utilityReadings}
            invoices={dataset.invoices}
            settings={dataset.settings}
            billingMonth={billingMonth}
            selectedPropertyId={selectedPropertyId}
            onBack={() => setActiveView('dashboard')}
            onChangeSelectedPropertyId={setSelectedPropertyId}
            onChangeBillingMonth={setBillingMonth}
            onCreateInvoice={handleCreateInvoice}
            onUpdateInvoice={handleUpdateInvoice}
            isReadOnly={isReadOnly}
          />
        )}

        {activeView === 'expenses' && (
          <ExpensesView
            properties={dataset.properties}
            invoices={dataset.invoices}
            expenses={dataset.expenses || []}
            billingMonth={billingMonth}
            ownerWhatsappPhone={dataset.settings.owner_whatsapp_phone}
            onBack={() => setActiveView('dashboard')}
            onChangeBillingMonth={setBillingMonth}
            onOpenAddExpenses={() => {
              if (!isReadOnly) setActiveView('add-expense');
            }}
            onUpdateExpense={handleUpdateExpense}
            onDeleteExpense={handleDeleteExpense}
            isReadOnly={isReadOnly}
            senderSignature={senderSignature}
          />
        )}

        {activeView === 'add-expense' && (
          <AddExpensesView
            session={session}
            properties={dataset.properties}
            invoices={dataset.invoices}
            expenses={dataset.expenses || []}
            billingMonth={billingMonth}
            ownerWhatsappPhone={dataset.settings.owner_whatsapp_phone}
            onBack={() => setActiveView('expenses')}
            onChangeBillingMonth={setBillingMonth}
            onSaveExpensesBatch={handleAddExpensesBatch}
            isReadOnly={isReadOnly}
            senderSignature={senderSignature}
          />
        )}

        {activeView === 'announcements' && (
          <AnnouncementsView
            properties={dataset.properties}
            units={dataset.units}
            tenants={dataset.tenants}
            utilityReadings={dataset.utilityReadings}
            invoices={dataset.invoices}
            billingMonth={billingMonth}
            selectedPropertyId={selectedPropertyId}
            onChangeSelectedPropertyId={setSelectedPropertyId}
            onBack={() => setActiveView('dashboard')}
            isReadOnly={isReadOnly}
            senderSignature={senderSignature}
          />
        )}

        {activeView === 'profile' && (
          <ProfileView
            session={session}
            onBack={() => setActiveView('dashboard')}
            onLogout={() => lockApp('App locked.')}
          />
        )}
      </main>

      {/* Fixed 4-Tab Bottom Navigation Bar (Home | Expenses | Invoices | Profile) */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 print:hidden"
        aria-label="Bottom Navigation"
      >
        <div className="max-w-md mx-auto bg-white/95 backdrop-blur-md border-t border-gray-200 grid grid-cols-4 h-16 pb-safe">
          <button
            type="button"
            onClick={() => setActiveView('dashboard')}
            className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
              activeView === 'dashboard'
                ? 'text-[#489E44]'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[11px] font-bold">Home</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('expenses')}
            className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
              activeView === 'expenses' || activeView === 'add-expense'
                ? 'text-[#489E44]'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Receipt className="w-5 h-5" />
            <span className="text-[11px] font-bold">Expenses</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('invoices')}
            className={`relative flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
              activeView === 'invoices'
                ? 'text-[#489E44]'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <div className="relative">
              <FileText className="w-5 h-5" />
              {pendingInvoiceCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] rounded-full bg-rose-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1">
                  {pendingInvoiceCount}
                </span>
              )}
            </div>
            <span className="text-[11px] font-bold">Invoices</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('profile')}
            className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
              activeView === 'profile'
                ? 'text-[#489E44]'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <User className="w-5 h-5" />
            <span className="text-[11px] font-bold">Profile</span>
          </button>
        </div>
      </nav>

      {!isReadOnly && (
        <SettingsModal
          isOpen={showSettingsModal}
          session={session}
          settings={dataset.settings}
          autoLockTimer={autoLockTimer}
          secretConfigured={secretConfigured}
          syncStatus={syncStatus}
          diagnostics={syncDiagnostics}
          isTestingConnection={isTestingConnection}
          isPulling={isPulling}
          isPushingAll={isPushingAll}
          pullFeedback={pullFeedback}
          onClose={() => setShowSettingsModal(false)}
          onSaveSettings={handleSaveSettings}
          onChangeAutoLockTimer={handleChangeAutoLockTimer}
          onTestConnectionAndSync={() => void handleTestConnectionAndSync()}
          onPullFromSheets={() => void handlePullFromSheets()}
          onPushAllToSheets={() => void handlePushAllToSheets()}
          onOpenInstallModal={() => setShowInstallModal(true)}
          onResetBaseline={handleResetBaseline}
        />
      )}

      {/* Explicit Confirmation Modal Before Seeding an Empty Google Sheet */}
      {showSeedEmptySheetModal && !isReadOnly && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-3 print:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="seed-empty-sheet-title"
        >
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 id="seed-empty-sheet-title" className="text-base font-bold text-[#0f172a]">
                  Initialize Google Sheet with Local Estate Data?
                </h3>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed break-words">
                  All {REQUIRED_SHEET_TABS.length} tabs ({REQUIRED_SHEET_TABS.join(', ')}) are ready in Google Sheet{' '}
                  <span className="font-mono font-semibold break-all">{SPREADSHEET_ID}</span> and
                  currently have 0 data rows. Would you like to write your current local
                  estate records into the spreadsheet now?
                </p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSeedEmptySheetModal(false)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Keep Sheet Empty
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSeedEmptySheetModal(false);
                  void handlePushAllToSheets();
                }}
                className="rounded-xl bg-[#489E44] px-4 py-2 text-xs font-bold text-white hover:bg-[#3E8E41] cursor-pointer"
              >
                Upload Estate Data to Sheet
              </button>
            </div>
          </div>
        </div>
      )}

      <InstallAppModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
      />

      <OfflineIndicator />
    </div>
  );
}
