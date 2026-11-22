import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  Building2,
  Calendar,
  Download,
  FileText,
  Gauge,
  Home,
  Lock,
  Megaphone,
  MessageSquare,
  Plus,
  Receipt,
  Settings,
  User,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import {
  AuthSession,
  HouseMaintenanceBill,
  InvoiceRecord,
  PropertyHouse,
  TenantRecord,
  Unit,
  UtilityReading,
} from '../types/estate';
import {
  calculateLeaseEndDate,
  formatBillingMonthLabel,
  formatCompactINR,
  formatINR,
  formatTenureReminderWhatsApp,
  getFloorSortRank,
  getTenureRemainingInfo,
  normalizeWhatsAppDigits,
} from '../utils/billingEngine';

interface MasterDashboardProps {
  session: AuthSession;
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  houseMaintenanceBills: HouseMaintenanceBill[];
  utilityReadings: UtilityReading[];
  invoices: InvoiceRecord[];
  billingMonth: string;
  selectedPropertyId: string;
  ownerWhatsappPhone: string;
  notificationPermission: NotificationPermission | 'unsupported';
  onRequestBrowserNotifications: () => void;
  onChangeSelectedPropertyId: (propertyId: string) => void;
  onOpenProperties: () => void;
  onOpenUnits: () => void;
  onOpenTenants: () => void;
  onOpenInvoices: () => void;
  onOpenMeters: () => void;
  onOpenMetersForUnit: (unitId: string) => void;
  onOpenMaintenance: () => void;
  onOpenExpenses: () => void;
  onOpenAnnouncements: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onQuickLock: () => void;
  onOpenOnboardUnit: (unitId?: string) => void;
  onOpenMoveOutUnit: (unitId: string) => void;
  isReadOnly?: boolean;
  senderSignature?: string;
}

type TenantFilterMode = 'active' | 'expiring' | 'vacated' | 'all';

const AVATAR_PALETTES = [
  'bg-emerald-100 text-[#3E8E41]',
  'bg-amber-100 text-amber-800',
  'bg-teal-100 text-teal-800',
  'bg-sky-100 text-sky-800',
  'bg-indigo-100 text-indigo-800',
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TN';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getAvatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

export const MasterDashboard: React.FC<MasterDashboardProps> = ({
  session,
  properties,
  units,
  tenants,
  houseMaintenanceBills,
  utilityReadings,
  invoices,
  billingMonth,
  selectedPropertyId,
  ownerWhatsappPhone,
  notificationPermission,
  onRequestBrowserNotifications,
  onChangeSelectedPropertyId,
  onOpenProperties,
  onOpenUnits,
  onOpenTenants,
  onOpenInvoices,
  onOpenMeters,
  onOpenMetersForUnit,
  onOpenMaintenance,
  onOpenExpenses,
  onOpenAnnouncements,
  onOpenSettings,
  onOpenProfile,
  onQuickLock,
  onOpenOnboardUnit,
  onOpenMoveOutUnit,
  isReadOnly = false,
  senderSignature = 'SRKP Rental Management',
}) => {
  const [tenantFilter, setTenantFilter] = useState<TenantFilterMode>('active');
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }, []);

  const scopedUnits = useMemo(
    () =>
      selectedPropertyId === 'ALL'
        ? units
        : units.filter((u) => u.property_id === selectedPropertyId),
    [units, selectedPropertyId]
  );

  const scopedTenants = useMemo(
    () =>
      selectedPropertyId === 'ALL'
        ? tenants
        : tenants.filter((t) => t.property_id === selectedPropertyId),
    [tenants, selectedPropertyId]
  );

  const activeTenants = useMemo(
    () => scopedTenants.filter((t) => t.is_active),
    [scopedTenants]
  );

  const vacatedTenants = useMemo(
    () => scopedTenants.filter((t) => !t.is_active),
    [scopedTenants]
  );

  const expiringTenants = useMemo(() => {
    return activeTenants
      .filter((t) => {
        const endDate =
          t.lease_end_date ||
          calculateLeaseEndDate(t.move_in_date, t.tenure_months || 11);
        return getTenureRemainingInfo(endDate).isExpiringSoon;
      })
      .map((tenant) => {
        const property = properties.find((p) => p.property_id === tenant.property_id);
        const unit = units.find((u) => u.unit_id === tenant.unit_id);
        const endDate =
          tenant.lease_end_date ||
          calculateLeaseEndDate(tenant.move_in_date, tenant.tenure_months || 11);
        const tenureInfo = getTenureRemainingInfo(endDate);
        return { tenant, property, unit, tenureInfo };
      })
      .sort((a, b) => a.tenureInfo.daysRemaining - b.tenureInfo.daysRemaining);
  }, [activeTenants, properties, units]);

  const monthStats = useMemo(() => {
    const monthInvoices = invoices.filter((inv) => {
      if (inv.billing_month !== billingMonth) return false;
      if (selectedPropertyId !== 'ALL' && inv.property_id !== selectedPropertyId) {
        return false;
      }
      return true;
    });
    const payableToOwner = monthInvoices.reduce(
      (s, inv) => s + inv.total_payable_to_owner,
      0
    );
    const pendingInvoicesCount = invoices.filter(
      (inv) =>
        inv.billing_month === billingMonth &&
        (inv.payment_status === 'Unpaid' || inv.payment_status === 'Partially Paid')
    ).length;

    // Fallback projected monthly rent when no invoices generated yet for the month
    const projectedMonthlyRent = activeTenants.reduce(
      (s, t) => s + (t.lease_type === 'Rental' ? t.monthly_rent : 0) + t.monthly_maintenance_charge,
      0
    );

    const kpiIncome = monthInvoices.length > 0 ? payableToOwner : projectedMonthlyRent;

    return {
      kpiIncome,
      pendingInvoicesCount,
      monthInvoicesCount: monthInvoices.length,
    };
  }, [invoices, billingMonth, selectedPropertyId, activeTenants]);

  const displayedTenants = useMemo(() => {
    const base =
      tenantFilter === 'active'
        ? activeTenants
        : tenantFilter === 'vacated'
          ? vacatedTenants
          : tenantFilter === 'expiring'
            ? expiringTenants.map((item) => item.tenant)
            : scopedTenants;

    return [...base].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return a.full_name.localeCompare(b.full_name);
    });
  }, [tenantFilter, activeTenants, vacatedTenants, expiringTenants, scopedTenants]);

  const vacantUnits = useMemo(
    () => scopedUnits.filter((u) => u.status === 'VACANT'),
    [scopedUnits]
  );

  const selectedTenantDetail = useMemo(() => {
    if (!selectedTenantId) return null;
    const tenant = tenants.find((t) => t.id === selectedTenantId);
    if (!tenant) return null;
    const property = properties.find((p) => p.property_id === tenant.property_id);
    const unit = units.find((u) => u.unit_id === tenant.unit_id);
    const endDate =
      tenant.lease_end_date ||
      calculateLeaseEndDate(tenant.move_in_date, tenant.tenure_months || 11);
    const tenureInfo = getTenureRemainingInfo(endDate);
    return { tenant, property, unit, tenureInfo };
  }, [selectedTenantId, tenants, properties, units]);

  const handleExportCsv = () => {
    const sortedUnits = [...scopedUnits].sort((a, b) => {
      const propA =
        properties.find((p) => p.property_id === a.property_id)?.property_name || '';
      const propB =
        properties.find((p) => p.property_id === b.property_id)?.property_name || '';
      if (propA !== propB) return propA.localeCompare(propB);
      const rankDiff = getFloorSortRank(a.floor) - getFloorSortRank(b.floor);
      if (rankDiff !== 0) return rankDiff;
      return a.unit_name.localeCompare(b.unit_name);
    });

    const headers = [
      'Property',
      'Floor',
      'Unit',
      'Type',
      'Status',
      'Tenant',
      'Lease Type',
      'Monthly Rent',
      'Tenant Cleaning Fee',
      'Building Maint Share',
      'EB Amount',
      'EB Mode',
      'Water Units',
      'Water Amount',
      'Payable To Owner',
      'Invoice Status',
    ];

    const lines = sortedUnits.map((unit) => {
      const property = properties.find((p) => p.property_id === unit.property_id);
      const tenant = unit.current_tenant_id
        ? tenants.find((t) => t.id === unit.current_tenant_id && t.is_active)
        : undefined;
      const reading = utilityReadings.find(
        (r) => r.unit_id === unit.unit_id && r.billing_month === billingMonth
      );
      const invoice = invoices.find(
        (inv) => inv.unit_id === unit.unit_id && inv.billing_month === billingMonth
      );
      const houseMaint = houseMaintenanceBills.find(
        (m) => m.property_id === unit.property_id && m.billing_month === billingMonth
      );
      const houseUnitCount = units.filter((u) => u.property_id === unit.property_id).length;
      const bldgShare =
        invoice?.building_maintenance_share ??
        (tenant && houseMaint && houseUnitCount > 0
          ? Math.round(houseMaint.total_house_maintenance / houseUnitCount)
          : 0);
      const rent = tenant ? (tenant.lease_type === 'Lease' ? 0 : tenant.monthly_rent) : 0;
      const cleaningFee =
        invoice?.tenant_cleaning_fee ?? (tenant ? tenant.monthly_maintenance_charge : 0);
      const eb = reading?.eb_bill_amount ?? invoice?.eb_amount ?? 0;
      const ebOwner = invoice?.eb_paid_to_owner ?? reading?.eb_paid_to_owner ?? true;
      const waterUnits = reading?.net_consumption ?? invoice?.water_net_units ?? 0;
      const waterAmt = reading?.water_bill_amount ?? invoice?.water_amount ?? 0;
      const payableOwner =
        invoice?.total_payable_to_owner ??
        (tenant ? rent + cleaningFee + bldgShare + waterAmt + (ebOwner ? eb : 0) : 0);

      const cols = [
        property?.property_name || unit.property_id,
        unit.floor,
        unit.unit_name,
        unit.unit_type,
        unit.status,
        tenant?.full_name || 'Vacant',
        tenant?.lease_type || '-',
        rent,
        cleaningFee,
        bldgShare,
        eb,
        tenant ? (ebOwner ? 'Owner' : 'Direct') : '-',
        waterUnits,
        waterAmt,
        payableOwner,
        invoice?.payment_status || 'PENDING',
      ];
      return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SRKP-Rental-Tool-Ledger-${billingMonth}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Strictly 8 launcher items in a 4x2 grid (NO Requests / Tickets module)
  const launcherGrid = [
    {
      id: 'properties',
      label: 'Properties',
      icon: Building2,
      badge: properties.length,
      onClick: onOpenProperties,
    },
    {
      id: 'units',
      label: 'Units',
      icon: Home,
      badge: units.length,
      onClick: onOpenUnits,
    },
    {
      id: 'tenants',
      label: 'Tenants',
      icon: Users,
      badge: tenants.filter((t) => t.is_active).length,
      onClick: onOpenTenants,
    },
    {
      id: 'invoices',
      label: 'Invoices',
      icon: FileText,
      badge: monthStats.pendingInvoicesCount,
      onClick: onOpenInvoices,
    },
    {
      id: 'meters',
      label: 'Meters',
      icon: Gauge,
      badge: 0,
      onClick: onOpenMeters,
    },
    {
      id: 'maintenance',
      label: 'Maintenance',
      icon: Wrench,
      badge: 0,
      onClick: onOpenMaintenance,
    },
    {
      id: 'expenses',
      label: 'Expenses',
      icon: Receipt,
      badge: 0,
      onClick: onOpenExpenses,
    },
    {
      id: 'announce',
      label: 'Announce',
      icon: Megaphone,
      badge: 0,
      onClick: onOpenAnnouncements,
    },
  ];

  return (
    <div className="min-h-full">
      {/* 1. Emerald Green Hero Header (#489E44 -> #3E8E41) */}
      <header className="bg-gradient-to-b from-[#489E44] to-[#3E8E41] text-white px-4 pt-4 pb-9">
        {/* Top Bar: Logo + Date + Greeting & Role Pill | Bell + User Avatar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#3E8E41] font-extrabold text-xs shadow-xs">
              SR
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-emerald-50/90 truncate">
                {todayFormatted}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-base font-bold tracking-tight text-white truncate">
                  Hi, {session.fullName || session.username}
                </span>
                <span className="rounded-full bg-[#FACC15] px-2 py-0.5 text-[10px] font-extrabold text-[#0f172a] leading-none shrink-0">
                  {session.accessType === 'admin' ? 'Admin' : 'Viewer'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowAlertsModal(true)}
              className="relative flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer"
              aria-label="Tenure Expiry Notifications"
            >
              <Bell className="w-4 h-4" />
              {expiringTenants.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#EF4444] px-1 text-[9px] font-bold text-white shadow-xs">
                  {expiringTenants.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onQuickLock}
              className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer"
              title="Quick Lock App"
              aria-label="Quick Lock"
            >
              <Lock className="w-4 h-4" />
            </button>

            {!isReadOnly && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer"
                title="Settings & Sync"
                aria-label="Open Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={onOpenProfile}
              className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-white text-[#3E8E41] font-bold text-xs shadow-xs hover:bg-emerald-50 transition-colors cursor-pointer"
              title={`Profile (${session.fullName || session.username})`}
              aria-label="Open User Profile"
            >
              <User className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 3 Floating White Rounded KPI Cards */}
        <div className="grid grid-cols-3 gap-2.5 mt-4">
          <button
            type="button"
            onClick={onOpenTenants}
            className="rounded-2xl bg-white p-3.5 shadow-sm text-left hover:bg-emerald-50/40 transition-colors cursor-pointer"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-[#489E44]">
              <Users className="w-4 h-4" />
            </div>
            <div className="mt-2 text-[11px] font-medium text-gray-500">Tenants</div>
            <div className="text-lg font-extrabold text-[#0f172a] font-mono tabular-nums leading-tight mt-0.5">
              {activeTenants.length}
            </div>
          </button>

          <button
            type="button"
            onClick={onOpenUnits}
            className="rounded-2xl bg-white p-3.5 shadow-sm text-left hover:bg-emerald-50/40 transition-colors cursor-pointer"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-[#489E44]">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="mt-2 text-[11px] font-medium text-gray-500">Units</div>
            <div className="text-lg font-extrabold text-[#0f172a] font-mono tabular-nums leading-tight mt-0.5">
              {scopedUnits.length}
            </div>
          </button>

          <button
            type="button"
            onClick={onOpenInvoices}
            className="rounded-2xl bg-white p-3.5 shadow-sm text-left hover:bg-emerald-50/40 transition-colors cursor-pointer"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-[#489E44]">
              <Wallet className="w-4 h-4" />
            </div>
            <div className="mt-2 text-[11px] font-medium text-gray-500">Income</div>
            <div className="text-lg font-extrabold text-[#0f172a] font-mono tabular-nums leading-tight mt-0.5 truncate">
              {formatCompactINR(monthStats.kpiIncome)}
            </div>
          </button>
        </div>

        {/* 4x2 White Outline Icon Action Grid (NO Requests Icon) */}
        <div className="grid grid-cols-4 gap-y-4 gap-x-2 mt-5">
          {launcherGrid.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className="flex flex-col items-center gap-1.5 group cursor-pointer"
              >
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/40 bg-white/10 text-white group-hover:bg-white/20 transition-colors">
                  <Icon className="w-5 h-5" />
                  {item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#EF4444] px-1 text-[9px] font-bold text-white shadow-xs">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-white/95 tracking-tight truncate max-w-full">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      {/* 2. Curved White Lower Sheet */}
      <section className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[55vh] space-y-4">
        {/* Filter & Quick-Add Bar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <select
              aria-label="Filter Tenants List"
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value as TenantFilterMode)}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-[#0f172a] min-h-[38px] max-w-[58%] truncate"
            >
              <option value="active">Active tenants ({activeTenants.length})</option>
              <option value="expiring">Expiring soon ({expiringTenants.length})</option>
              <option value="vacated">Vacated ({vacatedTenants.length})</option>
              <option value="all">All tenants ({scopedTenants.length})</option>
            </select>

            {properties.length > 1 && (
              <select
                aria-label="Filter by Property House"
                value={selectedPropertyId}
                onChange={(e) => onChangeSelectedPropertyId(e.target.value)}
                className="rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] font-semibold text-gray-700 min-h-[38px] max-w-[42%] truncate"
              >
                <option value="ALL">All Houses</option>
                {properties.map((p) => (
                  <option key={p.property_id} value={p.property_id}>
                    {p.property_name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer"
              title={`Export ${formatBillingMonthLabel(billingMonth)} Ledger CSV`}
              aria-label="Export CSV"
            >
              <Download className="w-4 h-4" />
            </button>
            {!isReadOnly && (
              <button
                type="button"
                onClick={() => onOpenOnboardUnit(vacantUnits[0]?.unit_id)}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#489E44] text-white hover:bg-[#3E8E41] shadow-xs cursor-pointer"
                title="Onboard New Tenant"
                aria-label="Onboard New Tenant"
              >
                <Plus className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Expiring Tenure Callout Strip (compact) */}
        {expiringTenants.length > 0 && tenantFilter !== 'vacated' && (
          <button
            type="button"
            onClick={() => setShowAlertsModal(true)}
            className="w-full rounded-2xl border border-amber-200 bg-amber-50/90 px-3.5 py-2.5 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-amber-100/70 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-xs font-semibold text-amber-950 truncate">
                {expiringTenants.length} tenure{expiringTenants.length === 1 ? '' : 's'} expiring within 4 months
              </span>
            </div>
            <span className="text-[11px] font-bold text-amber-800 shrink-0">
              View →
            </span>
          </button>
        )}

        {/* Stacked White Tenant Cards with Diagonal Corner Ribbons */}
        {displayedTenants.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-8 text-center space-y-2">
            <Users className="w-7 h-7 text-gray-400 mx-auto" />
            <div className="text-xs font-semibold text-gray-600">
              No tenants in this filter.
            </div>
            {!isReadOnly && vacantUnits.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenOnboardUnit(vacantUnits[0]?.unit_id)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#489E44] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Onboard to Vacant Unit</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayedTenants.map((tenant) => {
              const property = properties.find(
                (p) => p.property_id === tenant.property_id
              );
              const unit = units.find((u) => u.unit_id === tenant.unit_id);
              const endDate =
                tenant.lease_end_date ||
                calculateLeaseEndDate(tenant.move_in_date, tenant.tenure_months || 11);
              const tenureInfo = getTenureRemainingInfo(endDate);

              const ribbonLabel = !tenant.is_active
                ? 'VACATED'
                : tenureInfo.isExpiringSoon
                  ? 'EXPIRING'
                  : 'ACTIVE';
              const ribbonBg = !tenant.is_active
                ? 'bg-slate-500'
                : tenureInfo.isExpiringSoon
                  ? 'bg-amber-600'
                  : 'bg-[#489E44]';

              return (
                <article
                  key={tenant.id}
                  onClick={() => setSelectedTenantId(tenant.id)}
                  className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-xs hover:border-[#489E44]/40 transition-colors cursor-pointer"
                >
                  {/* Diagonal Corner Ribbon */}
                  <div
                    className={`absolute top-3 -right-8 w-28 rotate-45 text-center text-[9px] font-extrabold tracking-wider py-0.5 text-white shadow-2xs pointer-events-none ${ribbonBg}`}
                  >
                    {ribbonLabel}
                  </div>

                  <div className="flex items-center gap-3.5 pr-8">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-bold text-sm ${getAvatarTone(
                        tenant.full_name
                      )}`}
                    >
                      {getInitials(tenant.full_name)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold text-[#0f172a] truncate">
                        {tenant.full_name}
                      </h3>
                      <div className="text-[11px] text-gray-500 truncate mt-0.5">
                        {unit ? `${unit.unit_name} · ${unit.floor}` : tenant.unit_id}
                        {property ? ` · ${property.property_name}` : ''}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        {tenant.lease_type === 'Rental' ? (
                          <span className="font-semibold text-[#3E8E41] font-mono tabular-nums">
                            Monthly Rent: {formatINR(tenant.monthly_rent)}
                          </span>
                        ) : (
                          <span className="font-semibold text-[#3E8E41] font-mono tabular-nums">
                            Lease Deposit: {formatINR(tenant.lease_deposit)}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400">
                          · {tenant.lease_type}
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Quick Vacant Units Strip (1-tap onboard) */}
        {vacantUnits.length > 0 && (
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Vacant Units Ready ({vacantUnits.length})
              </span>
              <button
                type="button"
                onClick={onOpenUnits}
                className="text-[11px] font-semibold text-[#489E44] hover:underline cursor-pointer"
              >
                All Units →
              </button>
            </div>
            <div className="space-y-2">
              {vacantUnits.slice(0, 3).map((u) => {
                const prop = properties.find((p) => p.property_id === u.property_id);
                return (
                  <div
                    key={u.unit_id}
                    className="rounded-2xl border border-gray-100 bg-gray-50/80 px-3.5 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#0f172a] truncate">
                        {u.unit_name} ({u.unit_type})
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {prop?.property_name} · {u.floor}
                      </div>
                    </div>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => onOpenOnboardUnit(u.unit_id)}
                        className="rounded-xl bg-[#489E44] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#3E8E41] shrink-0 cursor-pointer"
                      >
                        + Onboard
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Notification Bell Modal: Tenure Expiry Alerts */}
      {showAlertsModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-0 sm:p-4 print:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-[28px] sm:rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-[#0f172a]">
                  Tenure Expiry Alerts
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Active tenancies within final 4 months
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAlertsModal(false)}
                className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 cursor-pointer"
                aria-label="Close alerts"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {notificationPermission !== 'granted' &&
              notificationPermission !== 'unsupported' && (
                <button
                  type="button"
                  onClick={onRequestBrowserNotifications}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#0f172a] px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  <BellRing className="w-4 h-4 text-[#FACC15]" />
                  <span>Enable Monthly Browser Alerts</span>
                </button>
              )}

            {expiringTenants.length === 0 ? (
              <div className="rounded-2xl bg-gray-50 p-6 text-center text-xs text-gray-500">
                No leases expiring within the next 4 months.
              </div>
            ) : (
              <div className="space-y-3">
                {expiringTenants.map(({ tenant, property, unit, tenureInfo }) => {
                  const propName = property?.property_name || tenant.property_id;
                  const unitName = unit?.unit_name || tenant.unit_id;
                  const tenantWaHref = `https://wa.me/${normalizeWhatsAppDigits(
                    tenant.whatsapp_phone
                  )}?text=${encodeURIComponent(
                    formatTenureReminderWhatsApp({
                      recipient: 'tenant',
                      tenant,
                      propertyName: propName,
                      unitName,
                      remainingLabel: tenureInfo.label,
                      senderSignature,
                    })
                  )}`;
                  const ownerWaHref = `https://wa.me/${normalizeWhatsAppDigits(
                    ownerWhatsappPhone || tenant.whatsapp_phone
                  )}?text=${encodeURIComponent(
                    formatTenureReminderWhatsApp({
                      recipient: 'owner',
                      tenant,
                      propertyName: propName,
                      unitName,
                      remainingLabel: tenureInfo.label,
                      senderSignature,
                    })
                  )}`;

                  return (
                    <div
                      key={tenant.id}
                      className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3.5 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-semibold text-[#3E8E41]">
                            {propName} · {unitName}
                          </div>
                          <div className="text-sm font-bold text-[#0f172a]">
                            {tenant.full_name}
                          </div>
                          <div className="text-[11px] font-mono text-gray-500">
                            Ends {tenant.lease_end_date} ({tenant.lease_type})
                          </div>
                        </div>
                        <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-[11px] font-mono font-bold text-amber-900">
                          {tenureInfo.label}
                        </span>
                      </div>

                      {!isReadOnly && (
                        <div className="flex gap-2">
                          <a
                            href={tenantWaHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-[#489E44] px-2.5 py-2 text-[11px] font-semibold text-white hover:bg-[#3E8E41]"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Remind Tenant</span>
                          </a>
                          <a
                            href={ownerWaHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-[#0f172a] hover:bg-gray-50"
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-[#489E44]" />
                            <span>Alert Owner</span>
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tenant Quick-Detail Modal (when tapping a tenant card on Home Dashboard) */}
      {selectedTenantDetail && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-0 sm:p-4 print:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-[28px] sm:rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-bold text-sm ${getAvatarTone(
                    selectedTenantDetail.tenant.full_name
                  )}`}
                >
                  {getInitials(selectedTenantDetail.tenant.full_name)}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-[#0f172a] truncate">
                    {selectedTenantDetail.tenant.full_name}
                  </h2>
                  <p className="text-xs text-gray-500 truncate">
                    {selectedTenantDetail.property?.property_name} ·{' '}
                    {selectedTenantDetail.unit?.unit_name} (
                    {selectedTenantDetail.unit?.floor})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTenantId(null)}
                className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 cursor-pointer shrink-0"
                aria-label="Close tenant details"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Agreement Type</span>
                <span className="font-bold text-[#0f172a]">
                  {selectedTenantDetail.tenant.lease_type} ({selectedTenantDetail.tenant.tenure_months}m)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">
                  {selectedTenantDetail.tenant.lease_type === 'Rental'
                    ? 'Monthly Rent'
                    : 'Lease Deposit'}
                </span>
                <span className="font-mono font-bold text-[#3E8E41]">
                  {selectedTenantDetail.tenant.lease_type === 'Rental'
                    ? formatINR(selectedTenantDetail.tenant.monthly_rent)
                    : formatINR(selectedTenantDetail.tenant.lease_deposit)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Monthly Cleaning Fee</span>
                <span className="font-mono font-semibold text-[#0f172a]">
                  {formatINR(selectedTenantDetail.tenant.monthly_maintenance_charge)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Water Rate</span>
                <span className="font-mono font-semibold text-[#0f172a]">
                  ₹{selectedTenantDetail.tenant.water_charge} / unit
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Lease Period</span>
                <span className="font-mono text-[#0f172a] inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-gray-400" />
                  {selectedTenantDetail.tenant.move_in_date} →{' '}
                  {selectedTenantDetail.tenant.lease_end_date}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">WhatsApp</span>
                <span className="font-mono text-[#0f172a]">
                  {selectedTenantDetail.tenant.whatsapp_phone}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  const uId = selectedTenantDetail.tenant.unit_id;
                  setSelectedTenantId(null);
                  onOpenMetersForUnit(uId);
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-[#0f172a] hover:bg-gray-50 cursor-pointer"
              >
                <Gauge className="w-4 h-4 text-[#489E44]" />
                <span>Capture Meters</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedTenantId(null);
                  onOpenInvoices();
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-[#0f172a] hover:bg-gray-50 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-[#489E44]" />
                <span>View Invoices</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedTenantId(null);
                  onOpenTenants();
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer"
              >
                <Users className="w-4 h-4" />
                <span>{isReadOnly ? 'View Tenant Info' : 'Edit & Agreement'}</span>
              </button>

              {!isReadOnly && selectedTenantDetail.tenant.is_active && (
                <button
                  type="button"
                  onClick={() => {
                    const uId = selectedTenantDetail.tenant.unit_id;
                    setSelectedTenantId(null);
                    onOpenMoveOutUnit(uId);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Move-Out Settle</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
