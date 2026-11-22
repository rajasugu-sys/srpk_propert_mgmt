import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Droplets,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Fingerprint,
  Home,
  IndianRupee,
  KeyRound,
  Lock,
  LogOut,
  Printer,
  ShieldCheck,
  User,
  Zap,
} from 'lucide-react';
import {
  AUTO_LOCK_OPTIONS,
  changeAccountPassword,
} from '../config/authConfig';
import {
  isBiometricEnrolledForUser,
  isPlatformBiometricSupported,
  registerPlatformBiometric,
  removeBiometricForUser,
} from '../services/biometricAuth';
import type {
  AppSettings,
  AuthSession,
  AutoLockTimerMode,
  InvoiceRecord,
  PropertyHouse,
  TenantRecord,
  Unit,
  UtilityReading,
} from '../types/estate';
import {
  formatBillingMonthLabel,
  formatINR,
  getTenureRemainingInfo,
} from '../utils/billingEngine';

type TenantTab = 'home' | 'bills' | 'profile';
type BillRangeFilter = '3m' | '6m' | '1y' | 'custom';

interface TenantAuthenticatedPortalProps {
  session: AuthSession;
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  utilityReadings: UtilityReading[];
  invoices: InvoiceRecord[];
  settings: AppSettings;
  autoLockMode: AutoLockTimerMode;
  onChangeAutoLockMode: (mode: AutoLockTimerMode) => void;
  onLockApp: (reason?: string) => void;
}

function subtractMonthsYYYYMM(baseDate: Date, monthsBack: number): string {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - (monthsBack - 1), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const TenantAuthenticatedPortal: React.FC<TenantAuthenticatedPortalProps> = ({
  session,
  properties,
  units,
  tenants,
  utilityReadings,
  invoices,
  settings,
  autoLockMode,
  onChangeAutoLockMode,
  onLockApp,
}) => {
  const [activeTab, setActiveTab] = useState<TenantTab>('home');
  const [rangeFilter, setRangeFilter] = useState<BillRangeFilter>('6m');
  const [customFromMonth, setCustomFromMonth] = useState(() =>
    subtractMonthsYYYYMM(new Date(), 6)
  );
  const [customToMonth, setCustomToMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [printableInvoice, setPrintableInvoice] = useState<InvoiceRecord | null>(null);

  // Profile password change & biometrics
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwdFields, setShowPwdFields] = useState(false);
  const [pwdStatus, setPwdStatus] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [isUpdatingPwd, setIsUpdatingPwd] = useState(false);

  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [biometricMsg, setBiometricMsg] = useState<string | null>(null);

  useEffect(() => {
    setBiometricEnrolled(isBiometricEnrolledForUser(session.userId));
    void isPlatformBiometricSupported().then(setBiometricSupported);
  }, [session.userId]);

  const tenant = useMemo(
    () =>
      tenants.find((t) => t.id === session.tenantId) ||
      tenants.find((t) => t.unit_id === session.unitId) ||
      tenants[0] ||
      null,
    [tenants, session.tenantId, session.unitId]
  );

  const unit = useMemo(
    () =>
      units.find((u) => u.unit_id === (tenant?.unit_id || session.unitId)) ||
      units[0] ||
      null,
    [units, tenant?.unit_id, session.unitId]
  );

  const property = useMemo(
    () =>
      properties.find(
        (p) => p.property_id === (tenant?.property_id || unit?.property_id)
      ) ||
      properties[0] ||
      null,
    [properties, tenant?.property_id, unit?.property_id]
  );

  const latestReading = useMemo(() => {
    const unitReadings = utilityReadings
      .filter((r) => r.unit_id === unit?.unit_id)
      .sort((a, b) => b.billing_month.localeCompare(a.billing_month));
    return unitReadings[0] || null;
  }, [utilityReadings, unit?.unit_id]);

  const tenantInvoices = useMemo(() => {
    return invoices
      .filter(
        (inv) =>
          (tenant && inv.tenant_id === tenant.id) ||
          (unit && inv.unit_id === unit.unit_id)
      )
      .sort((a, b) => b.billing_month.localeCompare(a.billing_month));
  }, [invoices, tenant, unit]);

  const filteredInvoices = useMemo(() => {
    if (tenantInvoices.length === 0) return [];
    const anchorParts = tenantInvoices[0].billing_month.split('-').map(Number);
    const anchorDate =
      anchorParts.length === 2 && anchorParts[0] && anchorParts[1]
        ? new Date(anchorParts[0], anchorParts[1] - 1, 1)
        : new Date();

    if (rangeFilter === '3m') {
      const cutoff = subtractMonthsYYYYMM(anchorDate, 3);
      return tenantInvoices.filter((inv) => inv.billing_month >= cutoff);
    }
    if (rangeFilter === '6m') {
      const cutoff = subtractMonthsYYYYMM(anchorDate, 6);
      return tenantInvoices.filter((inv) => inv.billing_month >= cutoff);
    }
    if (rangeFilter === '1y') {
      const cutoff = subtractMonthsYYYYMM(anchorDate, 12);
      return tenantInvoices.filter((inv) => inv.billing_month >= cutoff);
    }
    return tenantInvoices.filter((inv) => {
      if (customFromMonth && inv.billing_month < customFromMonth) return false;
      if (customToMonth && inv.billing_month > customToMonth) return false;
      return true;
    });
  }, [tenantInvoices, rangeFilter, customFromMonth, customToMonth]);

  const unpaidBalanceTotal = useMemo(
    () =>
      tenantInvoices
        .filter((inv) => !inv.is_locked && inv.balance_due > 0)
        .reduce((sum, inv) => sum + inv.balance_due, 0),
    [tenantInvoices]
  );

  const tenureInfo = tenant
    ? getTenureRemainingInfo(tenant.lease_end_date)
    : null;

  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdStatus(null);
    if (newPwd.trim().length < 4) {
      setPwdStatus({ type: 'err', text: 'New password must be at least 4 characters.' });
      return;
    }
    if (newPwd.trim() !== confirmPwd.trim()) {
      setPwdStatus({ type: 'err', text: 'New password and confirmation do not match.' });
      return;
    }
    if (!session.authToken) {
      setPwdStatus({ type: 'err', text: 'Session token missing. Please sign in again.' });
      return;
    }

    setIsUpdatingPwd(true);
    const res = await changeAccountPassword(
      session.authToken,
      currentPwd.trim(),
      newPwd.trim()
    );
    setIsUpdatingPwd(false);

    if (!res.ok) {
      setPwdStatus({
        type: 'err',
        text: 'error' in res ? res.error : 'Could not change password.',
      });
      return;
    }
    setCurrentPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setPwdStatus({ type: 'ok', text: res.message });
  };

  const handleToggleBiometric = async () => {
    setBiometricMsg(null);
    if (biometricEnrolled) {
      removeBiometricForUser(session.userId);
      setBiometricEnrolled(false);
      setBiometricMsg('Biometric login removed from this device.');
      return;
    }
    const res = await registerPlatformBiometric(
      session.userId,
      tenant?.full_name || session.fullName
    );
    if (!res.ok) {
      setBiometricMsg('error' in res ? res.error : 'Biometric enrollment failed.');
      return;
    }
    setBiometricEnrolled(true);
    setBiometricMsg('Face ID / Fingerprint enabled for quick sign-in.');
  };

  const handlePrintInvoice = (invoice: InvoiceRecord) => {
    setPrintableInvoice(invoice);
    setTimeout(() => window.print(), 100);
  };

  return (
    <div className="min-h-screen w-full max-w-md mx-auto bg-gray-50 shadow-xl flex flex-col overflow-x-hidden pb-24">
      {/* Emerald Green Hero Header */}
      <header className="bg-gradient-to-b from-[#489E44] to-[#3E8E41] text-white px-4 pt-5 pb-10 print:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#3E8E41] font-extrabold text-sm shadow-xs">
              SR
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-emerald-50/90 font-medium">
                {todayFormatted}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold text-white truncate">
                  Hi, {tenant?.full_name || session.fullName}
                </span>
                <span className="rounded-full bg-[#FACC15] px-2 py-0.5 text-[10px] font-bold text-[#0f172a] shrink-0">
                  Tenant
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onLockApp('App locked.')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 cursor-pointer shrink-0"
            title="Lock & Sign Out"
            aria-label="Lock & Sign Out"
          >
            <Lock className="w-4 h-4" />
          </button>
        </div>

        {/* Summary KPI Pills on Hero */}
        <div className="grid grid-cols-3 gap-2.5 mt-4">
          <div className="rounded-2xl bg-white p-3 shadow-xs">
            <div className="text-[11px] font-medium text-gray-500 truncate">
              Assigned Unit
            </div>
            <div className="text-sm font-extrabold text-[#0f172a] mt-0.5 truncate">
              {unit?.unit_name || '—'}
            </div>
          </div>
          <div className="rounded-2xl bg-white p-3 shadow-xs">
            <div className="text-[11px] font-medium text-gray-500 truncate">
              Monthly Rent
            </div>
            <div className="text-sm font-extrabold text-[#0f172a] mt-0.5 font-mono tabular-nums truncate">
              {tenant?.lease_type === 'Lease'
                ? '₹0 (Lease)'
                : formatINR(tenant?.monthly_rent || 0)}
            </div>
          </div>
          <div className="rounded-2xl bg-white p-3 shadow-xs">
            <div className="text-[11px] font-medium text-gray-500 truncate">
              Due Balance
            </div>
            <div
              className={`text-sm font-extrabold mt-0.5 font-mono tabular-nums truncate ${
                unpaidBalanceTotal > 0 ? 'text-rose-600' : 'text-[#3E8E41]'
              }`}
            >
              {formatINR(unpaidBalanceTotal)}
            </div>
          </div>
        </div>
      </header>

      {/* Curved White Lower Sheet */}
      <main className="flex-1 bg-white rounded-t-[28px] -mt-5 px-4 pt-6 pb-6 space-y-4 print:hidden">
        {/* TAB 1: MY HOME */}
        {activeTab === 'home' && (
          <div className="space-y-4">
            {/* Assigned House & Unit Occupancy Card */}
            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#3E8E41]">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-[#0f172a] truncate">
                      {property?.property_name || 'Assigned Residence'}
                    </h2>
                    <p className="text-[11px] text-gray-500 leading-snug">
                      {property?.address || 'Property address on file'}
                    </p>
                  </div>
                </div>
                <span className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-[10px] font-bold text-[#3E8E41] shrink-0">
                  ACTIVE
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-gray-100 text-xs">
                <div>
                  <div className="text-[11px] text-gray-500">Unit &amp; Floor</div>
                  <div className="font-bold text-[#0f172a]">
                    {unit?.unit_name || '—'} · {unit?.unit_type || ''}
                  </div>
                  <div className="text-[11px] text-gray-500">{unit?.floor || ''}</div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-500">Lease Tenure</div>
                  <div className="font-bold text-[#0f172a]">
                    {tenant?.move_in_date || '—'} → {tenant?.lease_end_date || '—'}
                  </div>
                  {tenureInfo && (
                    <div
                      className={`text-[11px] font-semibold ${
                        tenureInfo.isExpired
                          ? 'text-rose-600'
                          : tenureInfo.isExpiringSoon
                            ? 'text-amber-600'
                            : 'text-[#3E8E41]'
                      }`}
                    >
                      {tenureInfo.label}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Agreement & Monthly Charges */}
            {tenant && (
              <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0f172a]">
                  <IndianRupee className="w-4 h-4 text-[#489E44]" />
                  <span>Agreement &amp; Monthly Terms</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="text-[11px] text-gray-500">
                      {tenant.lease_type === 'Rental' ? 'Monthly Rent' : 'Lease Deposit'}
                    </div>
                    <div className="font-mono font-bold text-sm text-[#0f172a] mt-0.5">
                      {tenant.lease_type === 'Rental'
                        ? formatINR(tenant.monthly_rent)
                        : formatINR(tenant.lease_deposit)}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="text-[11px] text-gray-500">
                      {tenant.lease_type === 'Rental' ? 'Security Deposit' : 'Agreement Type'}
                    </div>
                    <div className="font-mono font-bold text-sm text-[#0f172a] mt-0.5">
                      {tenant.lease_type === 'Rental'
                        ? formatINR(tenant.security_deposit)
                        : 'Lease'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="text-[11px] text-gray-500">Cleaning Fee</div>
                    <div className="font-mono font-bold text-sm text-[#0f172a] mt-0.5">
                      {formatINR(tenant.monthly_maintenance_charge)}/mo
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <div className="text-[11px] text-gray-500">Water Unit Rate</div>
                    <div className="font-mono font-bold text-sm text-[#0f172a] mt-0.5">
                      ₹{tenant.water_charge}/unit
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Latest EB & Water Sub-Meter Readings */}
            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0f172a]">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span>Latest Meter Readings</span>
                </div>
                {latestReading && (
                  <span className="rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-[#3E8E41]">
                    {formatBillingMonthLabel(latestReading.billing_month)}
                  </span>
                )}
              </div>

              {unit && (
                <div className="text-[11px] text-gray-500 font-mono">
                  EB ID: {unit.eb_rr_number || '—'} · Water ID: {unit.water_rr_number || '—'}
                  {unit.water_rr_number2 ? ` / ${unit.water_rr_number2}` : ''}
                </div>
              )}

              {latestReading ? (
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900">
                      <Zap className="w-3.5 h-3.5 text-amber-600" />
                      <span>Unit Electricity (EB)</span>
                    </div>
                    <div className="font-mono font-bold text-sm text-[#0f172a] mt-1">
                      {formatINR(latestReading.eb_bill_amount)}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {latestReading.eb_paid_to_owner
                        ? 'Included in Owner Bill'
                        : 'Direct Utility Payment'}
                    </div>
                  </div>

                  <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-900">
                      <Droplets className="w-3.5 h-3.5 text-sky-600" />
                      <span>Water Sub-Meter</span>
                    </div>
                    <div className="font-mono font-bold text-sm text-[#0f172a] mt-1">
                      {formatINR(latestReading.water_bill_amount)}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                      {latestReading.prev_reading_1} → {latestReading.curr_reading_1} (
                      {latestReading.net_consumption}u)
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
                  No utility meter readings recorded for this unit yet.
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: MY BILLS */}
        {activeTab === 'bills' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">My Bills &amp; Invoices</h2>
              <p className="text-xs text-gray-500">
                Tap any billing cycle to view itemized rent, maintenance, water &amp; EB breakdown
              </p>
            </div>

            {/* Date / Period Filter Bar */}
            <div className="space-y-2.5">
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { id: '3m', label: '3 Months' },
                    { id: '6m', label: '6 Months' },
                    { id: '1y', label: '1 Year' },
                    { id: 'custom', label: 'Custom' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setRangeFilter(opt.id)}
                    className={`rounded-xl px-2 py-2 text-[11px] font-bold border transition-colors cursor-pointer min-h-[40px] ${
                      rangeFilter === opt.id
                        ? 'border-[#489E44] bg-[#489E44] text-white'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {rangeFilter === 'custom' && (
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2.5">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 mb-1">
                      From Month
                    </label>
                    <input
                      type="month"
                      value={customFromMonth}
                      onChange={(e) => setCustomFromMonth(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-[#0f172a]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 mb-1">
                      To Month
                    </label>
                    <input
                      type="month"
                      value={customToMonth}
                      onChange={(e) => setCustomToMonth(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-[#0f172a]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Invoices List */}
            {filteredInvoices.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center text-xs text-gray-500">
                <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                No invoices found in the selected period.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredInvoices.map((inv) => {
                  const isExpanded = expandedInvoiceId === inv.id;
                  const isPaid = inv.payment_status === 'Paid & Closed';
                  return (
                    <div
                      key={inv.id}
                      className="rounded-2xl border border-gray-200 bg-white shadow-xs overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedInvoiceId((prev) =>
                            prev === inv.id ? null : inv.id
                          )
                        }
                        className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50/70 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-[#0f172a]">
                              {formatBillingMonthLabel(inv.billing_month)}
                            </span>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                isPaid
                                  ? 'bg-emerald-50 text-[#3E8E41]'
                                  : inv.payment_status === 'Partially Paid'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-rose-50 text-rose-700'
                              }`}
                            >
                              {inv.payment_status}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-gray-400 mt-0.5">
                            {inv.id} · {inv.unit_name}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <div className="font-mono font-extrabold text-sm text-[#0f172a] tabular-nums">
                              {formatINR(inv.total_payable_to_owner)}
                            </div>
                            {inv.balance_due > 0 && !inv.is_locked && (
                              <div className="text-[10px] font-semibold text-rose-600 font-mono">
                                Due: {formatINR(inv.balance_due)}
                              </div>
                            )}
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-100 px-4 py-3.5 bg-gray-50/60 space-y-3 text-xs">
                          <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
                            <div className="flex justify-between px-3 py-2">
                              <span className="text-gray-600">
                                {inv.lease_type === 'Rental'
                                  ? 'Monthly Rent'
                                  : 'Lease Agreement (₹0 Rent)'}
                              </span>
                              <span className="font-mono font-semibold text-[#0f172a]">
                                {formatINR(inv.rent_amount)}
                              </span>
                            </div>
                            <div className="flex justify-between px-3 py-2">
                              <span className="text-gray-600">
                                Fixed Monthly Cleaning Fee
                              </span>
                              <span className="font-mono font-semibold text-[#0f172a]">
                                {formatINR(inv.tenant_cleaning_fee)}
                              </span>
                            </div>
                            <div className="flex justify-between px-3 py-2 gap-2">
                              <div>
                                <div className="text-gray-600">
                                  Building Maintenance Share
                                </div>
                                {inv.building_maintenance_total > 0 &&
                                  inv.building_unit_count > 0 && (
                                    <div className="text-[10px] text-gray-400 font-mono">
                                      {formatINR(inv.building_maintenance_total)} ÷{' '}
                                      {inv.building_unit_count} units
                                    </div>
                                  )}
                              </div>
                              <span className="font-mono font-semibold text-[#0f172a] shrink-0">
                                {formatINR(inv.building_maintenance_share)}
                              </span>
                            </div>
                            <div className="flex justify-between px-3 py-2 gap-2">
                              <div>
                                <div className="text-gray-600">Water Sub-Meter</div>
                                <div className="text-[10px] text-gray-400 font-mono">
                                  {inv.water_prev_1} → {inv.water_curr_1}
                                  {inv.water_curr_2 > 0 || inv.water_prev_2 > 0
                                    ? ` | M2: ${inv.water_prev_2} → ${inv.water_curr_2}`
                                    : ''}{' '}
                                  ({inv.water_net_units}u × ₹{inv.water_rate})
                                </div>
                              </div>
                              <span className="font-mono font-semibold text-[#0f172a] shrink-0">
                                {formatINR(inv.water_amount)}
                              </span>
                            </div>
                            <div className="flex justify-between px-3 py-2 gap-2">
                              <div>
                                <div className="text-gray-600">Unit Electricity (EB)</div>
                                <div className="text-[10px] text-gray-400">
                                  {inv.eb_paid_to_owner
                                    ? 'Paid to Owner'
                                    : 'Paid Directly to Utility Provider'}
                                </div>
                              </div>
                              <span className="font-mono font-semibold text-[#0f172a] shrink-0">
                                {formatINR(inv.eb_amount)}
                              </span>
                            </div>
                            {inv.carried_forward_balance > 0 && (
                              <div className="flex justify-between px-3 py-2 bg-purple-50/60">
                                <span className="text-purple-900 font-semibold">
                                  Previous Carried Forward Balance
                                </span>
                                <span className="font-mono font-bold text-purple-900">
                                  {formatINR(inv.carried_forward_balance)}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between px-3 py-2.5 bg-[#3E8E41] text-white font-bold">
                              <span>Total Payable to Owner</span>
                              <span className="font-mono">
                                {formatINR(inv.total_payable_to_owner)}
                              </span>
                            </div>
                            {inv.amount_paid > 0 && (
                              <div className="flex justify-between px-3 py-2 bg-emerald-50 text-[#3E8E41] font-semibold">
                                <span>Amount Paid</span>
                                <span className="font-mono">
                                  {formatINR(inv.amount_paid)}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* UPI Pay & Print Receipt */}
                          <div className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col items-center gap-2.5 text-center">
                            {!isPaid && inv.balance_due > 0 && (
                              <>
                                <div className="text-[11px] font-bold text-gray-700">
                                  Scan or Tap to Pay via UPI ({settings.merchant_upi_id})
                                </div>
                                <div className="p-2 rounded-xl border border-gray-200 bg-white">
                                  <QRCodeSVG
                                    value={inv.upi_link}
                                    size={110}
                                    bgColor="#ffffff"
                                    fgColor="#0f172a"
                                  />
                                </div>
                              </>
                            )}
                            <div className="w-full grid grid-cols-2 gap-2">
                              {!isPaid && inv.balance_due > 0 && (
                                <a
                                  href={inv.upi_link}
                                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#3E8E41] min-h-[42px]"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  <span>Pay via UPI</span>
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => handlePrintInvoice(inv)}
                                className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-[#0f172a] hover:bg-gray-50 cursor-pointer min-h-[42px] ${
                                  isPaid || inv.balance_due <= 0 ? 'col-span-2' : ''
                                }`}
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>Print Receipt</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PROFILE */}
        {activeTab === 'profile' && (
          <div className="space-y-4">
            {/* Identity Card */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#489E44] text-white font-bold text-lg">
                {(tenant?.full_name || session.fullName).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-bold text-[#0f172a] truncate">
                    {tenant?.full_name || session.fullName}
                  </span>
                  <span className="rounded-full bg-[#FACC15] px-2 py-0.5 text-[10px] font-bold text-[#0f172a]">
                    Tenant
                  </span>
                </div>
                <div className="text-xs text-gray-500 font-mono mt-0.5">
                  Mobile / ID: {session.mobileNumber || session.userId}
                </div>
                <div className="text-xs text-[#3E8E41] font-semibold mt-0.5">
                  {property?.property_name || 'Residence'} · {unit?.unit_name || 'Unit'}
                </div>
              </div>
            </div>

            {/* Change Password Card */}
            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0f172a]">
                  <KeyRound className="w-4 h-4 text-[#489E44]" />
                  <span>Change Password</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPwdFields((v) => !v)}
                  className="text-xs font-semibold text-[#3E8E41] cursor-pointer"
                >
                  {showPwdFields ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {pwdStatus && (
                <div
                  className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
                    pwdStatus.type === 'ok'
                      ? 'bg-emerald-50 text-[#3E8E41]'
                      : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  {pwdStatus.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{pwdStatus.text}</span>
                </div>
              )}

              <form onSubmit={(e) => void handleChangePassword(e)} className="space-y-2.5">
                <input
                  type={showPwdFields ? 'text' : 'password'}
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  placeholder="Current Password"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-[#0f172a] min-h-[42px]"
                  required
                />
                <input
                  type={showPwdFields ? 'text' : 'password'}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="New Password (min 4 chars)"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-[#0f172a] min-h-[42px]"
                  required
                />
                <input
                  type={showPwdFields ? 'text' : 'password'}
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  placeholder="Confirm New Password"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-[#0f172a] min-h-[42px]"
                  required
                />
                <button
                  type="submit"
                  disabled={isUpdatingPwd}
                  className="w-full rounded-xl bg-[#489E44] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#3E8E41] disabled:opacity-60 cursor-pointer min-h-[44px]"
                >
                  {isUpdatingPwd ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            </section>

            {/* Biometric Login Toggle */}
            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Fingerprint className="w-5 h-5 text-[#489E44] shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-[#0f172a]">
                      Face ID / Fingerprint Login
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {biometricEnrolled
                        ? 'Enabled on this device'
                        : biometricSupported
                          ? 'Available on this device'
                          : 'Requires supported HTTPS mobile browser'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggleBiometric()}
                  className={`rounded-xl px-3 py-2 text-xs font-bold cursor-pointer min-h-[40px] shrink-0 ${
                    biometricEnrolled
                      ? 'border border-rose-200 bg-rose-50 text-rose-700'
                      : 'bg-[#489E44] text-white'
                  }`}
                >
                  {biometricEnrolled ? 'Disable' : 'Enable'}
                </button>
              </div>
              {biometricMsg && (
                <div className="text-[11px] font-semibold text-[#3E8E41]">
                  {biometricMsg}
                </div>
              )}
            </section>

            {/* Auto-Lock Timer */}
            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0f172a]">
                <Clock className="w-4 h-4 text-[#489E44]" />
                <span>Auto-Lock Security Timer</span>
              </div>
              <select
                value={autoLockMode}
                onChange={(e) =>
                  onChangeAutoLockMode(e.target.value as AutoLockTimerMode)
                }
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-semibold text-[#0f172a] min-h-[44px]"
              >
                {AUTO_LOCK_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </section>

            {/* Lock & Sign Out */}
            <button
              type="button"
              onClick={() => onLockApp('Signed out and locked.')}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer min-h-[48px]"
            >
              <LogOut className="w-4 h-4" />
              <span>Lock &amp; Sign Out</span>
            </button>
          </div>
        )}
      </main>

      {/* Fixed 3-Tab Bottom Navigation Bar */}
      <nav
        aria-label="Tenant portal navigation"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 bg-white border-t border-gray-200 px-4 py-2 grid grid-cols-3 gap-1 print:hidden"
      >
        {(
          [
            { id: 'home', label: 'My Home', Icon: Home },
            { id: 'bills', label: 'My Bills', Icon: FileText },
            { id: 'profile', label: 'Profile', Icon: User },
          ] as const
        ).map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl cursor-pointer min-h-[44px] ${
                active ? 'text-[#3E8E41]' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] font-bold">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Print Receipt View */}
      {printableInvoice && (
        <div className="hidden print:block p-8 bg-white text-[#0f172a]">
          <div className="flex items-start justify-between border-b-2 border-[#0f172a] pb-4">
            <div>
              <h1 className="text-2xl font-bold">{settings.merchant_name}</h1>
              <p className="text-sm text-slate-600">
                {printableInvoice.property_name} — Monthly Rent &amp; Utility Statement
              </p>
            </div>
            <div className="text-right text-sm font-mono">
              <div className="font-bold">{printableInvoice.id}</div>
              <div>{formatBillingMonthLabel(printableInvoice.billing_month)}</div>
              <div>Status: {printableInvoice.payment_status}</div>
            </div>
          </div>
          <div className="my-5 text-sm">
            <div className="font-bold">{printableInvoice.tenant_name}</div>
            <div>
              {printableInvoice.property_name} — {printableInvoice.unit_name} (
              {printableInvoice.floor})
            </div>
          </div>
          <table className="w-full border-collapse border border-slate-300 text-sm">
            <tbody>
              <tr>
                <td className="border border-slate-300 p-2">Rent</td>
                <td className="border border-slate-300 p-2 text-right font-mono">
                  {formatINR(printableInvoice.rent_amount)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 p-2">Cleaning Fee</td>
                <td className="border border-slate-300 p-2 text-right font-mono">
                  {formatINR(printableInvoice.tenant_cleaning_fee)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 p-2">Building Maint Share</td>
                <td className="border border-slate-300 p-2 text-right font-mono">
                  {formatINR(printableInvoice.building_maintenance_share)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 p-2">
                  Water ({printableInvoice.water_net_units}u × ₹{printableInvoice.water_rate})
                </td>
                <td className="border border-slate-300 p-2 text-right font-mono">
                  {formatINR(printableInvoice.water_amount)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 p-2">Unit EB</td>
                <td className="border border-slate-300 p-2 text-right font-mono">
                  {formatINR(printableInvoice.eb_amount)}
                </td>
              </tr>
              {printableInvoice.carried_forward_balance > 0 && (
                <tr>
                  <td className="border border-slate-300 p-2">Carried Forward Balance</td>
                  <td className="border border-slate-300 p-2 text-right font-mono">
                    {formatINR(printableInvoice.carried_forward_balance)}
                  </td>
                </tr>
              )}
              <tr className="font-bold bg-slate-100">
                <td className="border border-slate-300 p-2">Total Payable to Owner</td>
                <td className="border border-slate-300 p-2 text-right font-mono">
                  {formatINR(printableInvoice.total_payable_to_owner)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
