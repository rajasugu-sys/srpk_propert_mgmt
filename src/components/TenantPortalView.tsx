import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Droplets,
  FileText,
  IndianRupee,
  MessageSquare,
  Paintbrush,
  Printer,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  EstateDataset,
  InvoiceRecord,
  MaintenanceRequest,
  PaymentStatus,
  PropertyHouse,
  RequestCategory,
  RequestStatus,
  Unit,
} from '../types/estate';
import {
  formatBillingMonthLabel,
  formatINR,
  getInvoiceDueTiming,
  normalizeWhatsAppDigits,
} from '../utils/billingEngine';

interface PortalTenantSummary {
  id: string;
  property_id: string;
  unit_id: string;
  full_name: string;
  whatsapp_phone: string;
  move_in_date: string;
  lease_end_date: string;
  lease_type: 'Rental' | 'Lease';
  monthly_rent: number;
  monthly_maintenance_charge: number;
  water_charge: number;
  is_active: boolean;
}

interface TenantPortalResponse {
  ok: boolean;
  tenant: PortalTenantSummary;
  property: PropertyHouse | null;
  unit: Unit | null;
  invoices: InvoiceRecord[];
  requests: MaintenanceRequest[];
  paymentInfo: {
    merchant_upi_id: string;
    merchant_name: string;
    owner_whatsapp_phone: string;
  };
}

interface TenantPortalViewProps {
  tenantId: string;
  initialInvoiceId?: string | null;
  localDataset: EstateDataset;
  onRequestCreated?: (request: MaintenanceRequest) => void;
}

const REQUEST_CATEGORIES: RequestCategory[] = [
  'Plumbing',
  'Electrical',
  'Painting',
  'Other',
];

function getInvoiceBadge(status: PaymentStatus): string {
  switch (status) {
    case 'Paid & Closed':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Partially Paid & Closed':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'Partially Paid':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'Unpaid':
    default:
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
}

function getRequestStatusBadge(status: RequestStatus): string {
  switch (status) {
    case 'Resolved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'In Progress':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'Open':
    default:
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
}

function CategoryIcon({ category }: { category: RequestCategory }) {
  switch (category) {
    case 'Plumbing':
      return <Droplets className="w-3.5 h-3.5 text-blue-600" />;
    case 'Electrical':
      return <Zap className="w-3.5 h-3.5 text-amber-600" />;
    case 'Painting':
      return <Paintbrush className="w-3.5 h-3.5 text-indigo-600" />;
    default:
      return <Wrench className="w-3.5 h-3.5 text-slate-600" />;
  }
}

export const TenantPortalView: React.FC<TenantPortalViewProps> = ({
  tenantId,
  initialInvoiceId,
  localDataset,
  onRequestCreated,
}) => {
  const [serverData, setServerData] = useState<TenantPortalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(
    initialInvoiceId || ''
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Maintenance Request Submission Form
  const [category, setCategory] = useState<RequestCategory>('Plumbing');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [submittedLocalRequests, setSubmittedLocalRequests] = useState<
    MaintenanceRequest[]
  >([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/portal/tenant/${encodeURIComponent(tenantId)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as TenantPortalResponse;
      })
      .then((json) => {
        if (active && json?.ok) {
          setServerData(json);
        }
      })
      .catch(() => {
        // fallback cleanly to localDataset
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tenantId]);

  const fallbackTenant = useMemo(
    () => localDataset.tenants.find((t) => t.id === tenantId) || null,
    [localDataset.tenants, tenantId]
  );

  const tenant: PortalTenantSummary | null = serverData?.tenant || fallbackTenant;
  const property: PropertyHouse | null = useMemo(() => {
    if (serverData?.property) return serverData.property;
    if (!tenant) return null;
    return (
      localDataset.properties.find((p) => p.property_id === tenant.property_id) ||
      null
    );
  }, [serverData?.property, tenant, localDataset.properties]);

  const unit: Unit | null = useMemo(() => {
    if (serverData?.unit) return serverData.unit;
    if (!tenant) return null;
    return localDataset.units.find((u) => u.unit_id === tenant.unit_id) || null;
  }, [serverData?.unit, tenant, localDataset.units]);

  const invoices: InvoiceRecord[] = useMemo(() => {
    const rawList =
      serverData?.invoices && serverData.invoices.length > 0
        ? serverData.invoices
        : localDataset.invoices.filter((inv) => inv.tenant_id === tenantId);
    return [...rawList].sort((a, b) =>
      b.billing_month.localeCompare(a.billing_month)
    );
  }, [serverData?.invoices, localDataset.invoices, tenantId]);

  const requests: MaintenanceRequest[] = useMemo(() => {
    const base =
      serverData?.requests && serverData.requests.length > 0
        ? serverData.requests
        : (localDataset.requests || []).filter(
            (r) =>
              r.tenant_id === tenantId ||
              (unit ? r.unit_id === unit.unit_id : false)
          );
    const mergedMap = new Map<string, MaintenanceRequest>();
    [...submittedLocalRequests, ...base].forEach((r) => {
      if (!mergedMap.has(r.id)) mergedMap.set(r.id, r);
    });
    return Array.from(mergedMap.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
  }, [
    serverData?.requests,
    localDataset.requests,
    submittedLocalRequests,
    tenantId,
    unit,
  ]);

  const paymentInfo = serverData?.paymentInfo || {
    merchant_upi_id: localDataset.settings.merchant_upi_id,
    merchant_name: localDataset.settings.merchant_name,
    owner_whatsapp_phone: localDataset.settings.owner_whatsapp_phone,
  };

  const activeInvoice = useMemo(() => {
    if (invoices.length === 0) return null;
    if (selectedInvoiceId) {
      const match = invoices.find((inv) => inv.id === selectedInvoiceId);
      if (match) return match;
    }
    return invoices[0];
  }, [invoices, selectedInvoiceId]);

  useEffect(() => {
    if (invoices.length > 0 && !selectedInvoiceId) {
      setSelectedInvoiceId(
        initialInvoiceId && invoices.some((i) => i.id === initialInvoiceId)
          ? initialInvoiceId
          : invoices[0].id
      );
    }
  }, [invoices, selectedInvoiceId, initialInvoiceId]);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitFeedback(null);

    const cleanTitle = issueTitle.trim();
    const cleanDesc = issueDescription.trim();
    if (!cleanTitle || !cleanDesc) {
      setSubmitFeedback({
        type: 'error',
        message: 'Please provide both a short issue title and details.',
      });
      return;
    }

    setSubmittingRequest(true);
    try {
      const res = await fetch(
        `/api/portal/tenant/${encodeURIComponent(tenantId)}/requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category,
            title: cleanTitle,
            description: cleanDesc,
          }),
        }
      );

      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        request?: MaintenanceRequest;
        sheetsSynced?: boolean;
        error?: string;
      };

      if (res.ok && json.ok && json.request) {
        setSubmittedLocalRequests((prev) => [json.request!, ...prev]);
        onRequestCreated?.(json.request);
        setIssueTitle('');
        setIssueDescription('');
        setSubmitFeedback({
          type: 'success',
          message: json.sheetsSynced
            ? `Request ${json.request.id} logged and synced to management sheet.`
            : `Request ${json.request.id} logged for your unit. Owner has been notified.`,
        });
      } else {
        setSubmitFeedback({
          type: 'error',
          message: json.error || 'Could not submit request right now.',
        });
      }
    } catch {
      if (tenant) {
        const nowIso = new Date().toISOString();
        const offlineReq: MaintenanceRequest = {
          id: `REQ-${Date.now().toString().slice(-6)}`,
          property_id: tenant.property_id,
          property_name: property?.property_name || tenant.property_id,
          unit_id: tenant.unit_id,
          unit_name: unit?.unit_name || tenant.unit_id,
          tenant_id: tenant.id,
          tenant_name: tenant.full_name,
          category,
          title: cleanTitle,
          description: cleanDesc,
          status: 'Open',
          reported_by: 'Tenant Portal',
          created_at: nowIso,
          updated_at: nowIso,
          resolved_at: null,
          resolution_note: '',
        };
        setSubmittedLocalRequests((prev) => [offlineReq, ...prev]);
        onRequestCreated?.(offlineReq);
        setIssueTitle('');
        setIssueDescription('');
        setSubmitFeedback({
          type: 'success',
          message: `Request ${offlineReq.id} saved locally for this unit.`,
        });
      } else {
        setSubmitFeedback({
          type: 'error',
          message: 'Network error while submitting request.',
        });
      }
    } finally {
      setSubmittingRequest(false);
    }
  };

  if (loading && !tenant) {
    return (
      <div className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-6">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white px-6 py-5 text-sm font-semibold text-slate-600 shadow-xs">
          Loading resident statement...
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border border-[#e2e8f0] bg-white p-6 text-center space-y-3 shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-[#0f172a]">
            Resident Portal Link Not Found
          </h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            We could not locate a tenant statement for reference ID{' '}
            <span className="font-mono font-semibold text-[#0f172a]">{tenantId}</span>.
            Please ask the property owner to share your updated portal link.
          </p>
        </div>
      </div>
    );
  }

  const totalOpenBalance = invoices
    .filter((i) => !i.is_locked && i.balance_due > 0)
    .reduce((sum, i) => sum + i.balance_due, 0);
  const dueInfo = activeInvoice ? getInvoiceDueTiming(activeInvoice) : null;
  const ownerWaHref = `https://wa.me/${normalizeWhatsAppDigits(
    paymentInfo.owner_whatsapp_phone
  )}?text=${encodeURIComponent(
    `Hello, this is ${tenant.full_name} (${property?.property_name || ''} · ${
      unit?.unit_name || ''
    }). Sharing an update regarding my monthly statement.`
  )}`;

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0f172a]">
      {/* Portal Top Header (hidden in print) */}
      <header className="bg-white border-b border-[#e2e8f0] print:hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0f172a] text-white font-bold text-xs">
              SR
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-[#0f172a] truncate">
                  {property?.property_name || 'SRPK Estate'} · Resident Portal
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <ShieldCheck className="w-3 h-3" />
                  Read-Only Statement
                </span>
              </div>
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {tenant.full_name} · {unit ? `${unit.unit_name} (${unit.floor})` : tenant.unit_id} ·{' '}
                {tenant.lease_type}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={ownerWaHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#10b981] px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-600 min-h-[40px]"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>WhatsApp Owner</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Screen Content (hidden in print) */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 print:hidden">
        {/* Resident Overview Strip */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 sm:p-5">
            <div className="text-xs font-semibold text-slate-500">Unit &amp; Residence</div>
            <div className="mt-1.5 text-base font-bold text-[#0f172a]">
              {unit?.unit_name || tenant.unit_id}{' '}
              {unit?.unit_type ? `· ${unit.unit_type}` : ''}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {property?.address || property?.property_name}
            </div>
          </div>

          <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 sm:p-5">
            <div className="text-xs font-semibold text-slate-500">Agreement &amp; Tenure</div>
            <div className="mt-1.5 text-base font-bold text-[#0f172a]">
              {tenant.lease_type}{' '}
              <span className="font-mono text-sm font-semibold text-[#2563eb]">
                {tenant.lease_type === 'Rental'
                  ? `(${formatINR(tenant.monthly_rent)}/mo)`
                  : '(Zero Monthly Rent)'}
              </span>
            </div>
            <div className="text-xs text-slate-500 font-mono mt-1">
              {tenant.move_in_date} → {tenant.lease_end_date}
            </div>
          </div>

          <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 sm:p-5">
            <div className="text-xs font-semibold text-slate-500">
              Current Open Balance Due
            </div>
            <div
              className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${
                totalOpenBalance > 0 ? 'text-amber-600' : 'text-emerald-600'
              }`}
            >
              {formatINR(totalOpenBalance)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {totalOpenBalance > 0
                ? 'Pay directly via UPI QR or UPI ID below'
                : 'All current dues settled'}
            </div>
          </div>
        </section>

        {/* Monthly Invoices Selector + Itemized Breakdown + UPI Payment */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Invoice History & Active Statement */}
          <div className="lg:col-span-8 space-y-4">
            {/* Month Pill Selector */}
            {invoices.length > 0 && (
              <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-[#0f172a]">
                    Monthly Rent &amp; Utility Statements ({invoices.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Select any billing month to inspect itemized meters or print receipt
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {invoices.map((inv) => {
                    const selected = activeInvoice?.id === inv.id;
                    return (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => setSelectedInvoiceId(inv.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer min-h-[36px] ${
                          selected
                            ? 'border-[#2563eb] bg-blue-50 text-[#2563eb]'
                            : 'border-[#e2e8f0] bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>{formatBillingMonthLabel(inv.billing_month)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeInvoice ? (
              <div className="rounded-xl border border-[#e2e8f0] bg-white overflow-hidden">
                <div className="px-5 py-4 border-b border-[#e2e8f0] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-[#2563eb]">
                        {activeInvoice.id}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${getInvoiceBadge(
                          activeInvoice.payment_status
                        )}`}
                      >
                        {activeInvoice.payment_status === 'Paid & Closed' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        {activeInvoice.payment_status}
                      </span>
                      {dueInfo &&
                        (dueInfo.isOverdue || dueInfo.isDueSoon) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
                            {dueInfo.label} (Due {dueInfo.dueDate})
                          </span>
                        )}
                    </div>
                    <h3 className="text-base font-bold text-[#0f172a] mt-1">
                      Statement for {formatBillingMonthLabel(activeInvoice.billing_month)}
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-2 text-xs font-semibold text-[#0f172a] hover:bg-slate-50 cursor-pointer min-h-[40px]"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#2563eb]" />
                    <span>Download / Print Receipt</span>
                  </button>
                </div>

                <div className="divide-y divide-slate-100 text-xs sm:text-sm">
                  <div className="flex justify-between px-5 py-3">
                    <span className="text-slate-600">
                      {activeInvoice.lease_type === 'Rental'
                        ? 'Monthly Rent'
                        : 'Lease Agreement (₹0 Rent)'}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                      {formatINR(activeInvoice.rent_amount)}
                    </span>
                  </div>

                  <div className="flex justify-between px-5 py-3">
                    <div>
                      <div className="text-slate-700 font-medium">
                        Monthly Cleaning Fee
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Fixed monthly unit maintenance &amp; cleaning charge
                      </div>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                      {formatINR(activeInvoice.tenant_cleaning_fee)}
                    </span>
                  </div>

                  <div className="flex justify-between px-5 py-3 gap-4">
                    <div>
                      <div className="text-slate-700 font-medium">
                        Building Maintenance Share
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {activeInvoice.building_maintenance_total > 0 &&
                        activeInvoice.building_unit_count > 0
                          ? `${formatINR(activeInvoice.building_maintenance_total)} ÷ ${
                              activeInvoice.building_unit_count
                            } units`
                          : 'Shared building motor EB & upkeep'}
                      </div>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-[#0f172a] shrink-0">
                      {formatINR(activeInvoice.building_maintenance_share)}
                    </span>
                  </div>

                  <div className="flex justify-between px-5 py-3 gap-4">
                    <div>
                      <div className="text-slate-700 font-medium">
                        Water Sub-Meter Charges
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        M1: {activeInvoice.water_prev_1} → {activeInvoice.water_curr_1}
                        {activeInvoice.water_curr_2 > 0 ||
                        activeInvoice.water_prev_2 > 0
                          ? ` | M2: ${activeInvoice.water_prev_2} → ${activeInvoice.water_curr_2}`
                          : ''}{' '}
                        ({activeInvoice.water_net_units} units × ₹
                        {activeInvoice.water_rate})
                      </div>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-[#0f172a] shrink-0">
                      {formatINR(activeInvoice.water_amount)}
                    </span>
                  </div>

                  <div className="flex justify-between px-5 py-3 gap-4">
                    <div>
                      <div className="text-slate-700 font-medium">
                        Unit Electricity (EB)
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {activeInvoice.eb_paid_to_owner
                          ? 'Included in Owner Payable'
                          : 'Paid Directly to Utility Provider'}
                      </div>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-[#0f172a] shrink-0">
                      {formatINR(activeInvoice.eb_amount)}
                    </span>
                  </div>

                  {activeInvoice.carried_forward_balance > 0 && (
                    <div className="flex justify-between px-5 py-3 bg-indigo-50/60">
                      <div>
                        <div className="text-indigo-900 font-semibold">
                          Carried-Forward Previous Balance
                        </div>
                        <div className="text-[11px] text-indigo-700">
                          Unpaid balance from prior billing cycle
                        </div>
                      </div>
                      <span className="font-mono tabular-nums font-bold text-indigo-900">
                        {formatINR(activeInvoice.carried_forward_balance)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between px-5 py-3 bg-[#f8f9ff] text-xs font-semibold text-slate-600">
                    <span>Total Bill Value (incl. Utility EB)</span>
                    <span className="font-mono tabular-nums text-[#0f172a]">
                      {formatINR(activeInvoice.total_bill_value)}
                    </span>
                  </div>

                  <div className="flex justify-between px-5 py-3.5 bg-[#0f172a] text-white font-bold">
                    <span>Total Payable to Owner</span>
                    <span className="font-mono tabular-nums text-base">
                      {formatINR(activeInvoice.total_payable_to_owner)}
                    </span>
                  </div>

                  {activeInvoice.amount_paid > 0 && (
                    <>
                      <div className="flex justify-between px-5 py-2.5 bg-emerald-50 text-emerald-800 font-semibold text-xs">
                        <span>Amount Paid</span>
                        <span className="font-mono tabular-nums">
                          {formatINR(activeInvoice.amount_paid)}
                        </span>
                      </div>
                      <div className="flex justify-between px-5 py-3 bg-white font-bold text-rose-700 text-sm">
                        <span>Remaining Balance Due</span>
                        <span className="font-mono tabular-nums">
                          {formatINR(activeInvoice.balance_due)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[#e2e8f0] bg-white p-8 text-center text-xs text-slate-500">
                No monthly invoices have been generated for your unit yet.
              </div>
            )}
          </div>

          {/* Right: Owner UPI Payment Instructions */}
          <aside className="lg:col-span-4 rounded-xl border border-[#e2e8f0] bg-white p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <IndianRupee className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[#0f172a]">
                  Owner UPI Payment
                </h2>
                <p className="text-[11px] text-slate-500">
                  Scan QR or pay via any UPI app (GPay / PhonePe / Paytm)
                </p>
              </div>
            </div>

            {activeInvoice ? (
              <div className="flex flex-col items-center rounded-xl border border-[#e2e8f0] bg-[#f8f9ff] p-4 space-y-3">
                <div className="rounded-xl bg-white p-3 border border-[#e2e8f0]">
                  <QRCodeSVG
                    value={activeInvoice.upi_link}
                    size={156}
                    bgColor="#ffffff"
                    fgColor="#0f172a"
                  />
                </div>
                <div className="text-center">
                  <div className="text-[11px] text-slate-500">Payee Name</div>
                  <div className="text-xs font-bold text-[#0f172a]">
                    {paymentInfo.merchant_name}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-[#e2e8f0] bg-[#f8f9ff] p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Owner UPI ID
                </div>
                <div className="font-mono text-xs font-bold text-[#0f172a] truncate">
                  {paymentInfo.merchant_upi_id}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(paymentInfo.merchant_upi_id, 'upi-id')}
                className="inline-flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0f172a] hover:bg-slate-50 cursor-pointer shrink-0 min-h-[34px]"
              >
                {copiedKey === 'upi-id' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            {activeInvoice && activeInvoice.balance_due > 0 && (
              <a
                href={activeInvoice.upi_link}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 min-h-[42px]"
              >
                <IndianRupee className="w-4 h-4" />
                <span>Pay {formatINR(activeInvoice.balance_due)} via UPI App</span>
              </a>
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Payment Note: Mention{' '}
              <span className="font-mono font-semibold text-[#0f172a]">
                {unit?.unit_name || tenant.unit_id}
              </span>{' '}
              and month when transferring, then send a screenshot via WhatsApp if
              requested.
            </p>
          </aside>
        </section>

        {/* Report an Issue / Maintenance Request + Unit Request History */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-6 rounded-xl border border-[#e2e8f0] bg-white p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-[#2563eb]">
                <Wrench className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-[#0f172a]">
                  Report an Issue / Maintenance Request
                </h2>
                <p className="text-xs text-slate-500">
                  Submit plumbing, electrical, painting, or repair requests directly to
                  management
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmitRequest} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Category *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {REQUEST_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold cursor-pointer min-h-[40px] ${
                        category === cat
                          ? 'border-[#2563eb] bg-blue-50 text-[#0f172a]'
                          : 'border-[#e2e8f0] bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <CategoryIcon category={cat} />
                      <span>{cat}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="portal-issue-title"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Issue Summary *
                </label>
                <input
                  id="portal-issue-title"
                  type="text"
                  value={issueTitle}
                  onChange={(e) => setIssueTitle(e.target.value)}
                  placeholder="e.g., Kitchen sink pipe dripping"
                  className="w-full rounded-lg border border-[#e2e8f0] px-3.5 py-2.5 text-sm text-[#0f172a] min-h-[44px]"
                />
              </div>

              <div>
                <label
                  htmlFor="portal-issue-desc"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Details &amp; Preferred Visit Time *
                </label>
                <textarea
                  id="portal-issue-desc"
                  rows={3}
                  value={issueDescription}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  placeholder="Describe where the issue is located and when someone is available at the flat..."
                  className="w-full rounded-lg border border-[#e2e8f0] px-3.5 py-2.5 text-sm text-[#0f172a]"
                />
              </div>

              {submitFeedback && (
                <div
                  className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold ${
                    submitFeedback.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  }`}
                >
                  {submitFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span>{submitFeedback.message}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submittingRequest}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0f172a] px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 cursor-pointer min-h-[44px]"
              >
                <Send className="w-3.5 h-3.5 text-[#10b981]" />
                <span>
                  {submittingRequest ? 'Submitting Request...' : 'Submit Maintenance Request'}
                </span>
              </button>
            </form>
          </div>

          {/* Right: Submitted Maintenance Requests Status */}
          <div className="lg:col-span-6 rounded-xl border border-[#e2e8f0] bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#2563eb]" />
                <h2 className="text-sm sm:text-base font-bold text-[#0f172a]">
                  Your Unit Requests ({requests.length})
                </h2>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {unit?.unit_name || tenant.unit_id}
              </span>
            </div>

            {requests.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                No maintenance requests logged for this unit yet.
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((req) => (
                  <article
                    key={req.id}
                    className="rounded-xl border border-[#e2e8f0] bg-[#f8f9ff]/60 p-3.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex items-center gap-1 rounded-md border border-[#e2e8f0] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#0f172a]">
                          <CategoryIcon category={req.category} />
                          <span>{req.category}</span>
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {req.id}
                        </span>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold shrink-0 ${getRequestStatusBadge(
                          req.status
                        )}`}
                      >
                        {req.status}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-[#0f172a]">
                      {req.title}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {req.description}
                    </p>
                    {req.resolution_note && (
                      <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 px-2.5 py-1.5 text-[11px] text-emerald-900">
                        <strong>Owner Note:</strong> {req.resolution_note}
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-slate-400">
                      Logged {new Date(req.created_at).toLocaleDateString('en-IN')}
                      {req.resolved_at
                        ? ` · Resolved ${new Date(req.resolved_at).toLocaleDateString('en-IN')}`
                        : ''}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Print-Ready Official Receipt */}
      {activeInvoice && (
        <div className="hidden print:block p-8 bg-white text-[#0f172a]">
          <div className="flex items-start justify-between border-b-2 border-[#0f172a] pb-4">
            <div>
              <h1 className="text-2xl font-bold">{paymentInfo.merchant_name}</h1>
              <p className="text-sm text-slate-600">
                {activeInvoice.property_name} — Official Resident Rent &amp; Utility Receipt
              </p>
            </div>
            <div className="text-right text-sm font-mono">
              <div className="font-bold">{activeInvoice.id}</div>
              <div>{formatBillingMonthLabel(activeInvoice.billing_month)}</div>
              <div>Status: {activeInvoice.payment_status}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 my-6 text-sm">
            <div>
              <div className="text-xs uppercase text-slate-500 font-bold">Resident</div>
              <div className="font-bold text-base mt-1">{activeInvoice.tenant_name}</div>
              <div>{activeInvoice.whatsapp_phone}</div>
              <div>Agreement: {activeInvoice.lease_type}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase text-slate-500 font-bold">Unit</div>
              <div className="font-bold text-base mt-1">
                {activeInvoice.property_name} — {activeInvoice.unit_name}
              </div>
              <div>
                {activeInvoice.unit_type} · {activeInvoice.floor}
              </div>
            </div>
          </div>

          <table className="w-full border-collapse border border-slate-300 text-sm">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 py-2 px-3 text-left">Description</th>
                <th className="border border-slate-300 py-2 px-3 text-left">Details</th>
                <th className="border border-slate-300 py-2 px-3 text-right">Amount (INR)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-300 py-2 px-3 font-medium">
                  Monthly Rent
                </td>
                <td className="border border-slate-300 py-2 px-3">
                  {activeInvoice.lease_type} Terms
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(activeInvoice.rent_amount)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 py-2 px-3 font-medium">
                  Monthly Cleaning Fee
                </td>
                <td className="border border-slate-300 py-2 px-3">
                  Fixed monthly cleaning charge
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(activeInvoice.tenant_cleaning_fee)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 py-2 px-3 font-medium">
                  Building Maintenance Share
                </td>
                <td className="border border-slate-300 py-2 px-3">
                  {activeInvoice.building_maintenance_total > 0 &&
                  activeInvoice.building_unit_count > 0
                    ? `${formatINR(activeInvoice.building_maintenance_total)} ÷ ${activeInvoice.building_unit_count} units`
                    : 'Shared building expenses'}
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(activeInvoice.building_maintenance_share)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 py-2 px-3 font-medium">
                  Water Sub-Meter
                </td>
                <td className="border border-slate-300 py-2 px-3 font-mono text-xs">
                  {activeInvoice.water_prev_1}→{activeInvoice.water_curr_1} (
                  {activeInvoice.water_net_units}u × ₹{activeInvoice.water_rate})
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(activeInvoice.water_amount)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 py-2 px-3 font-medium">
                  Unit Electricity (EB)
                </td>
                <td className="border border-slate-300 py-2 px-3">
                  {activeInvoice.eb_paid_to_owner
                    ? 'Payable to Owner'
                    : 'Paid Directly to Utility Provider'}
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(activeInvoice.eb_amount)}
                </td>
              </tr>
              {activeInvoice.carried_forward_balance > 0 && (
                <tr>
                  <td className="border border-slate-300 py-2 px-3 font-medium">
                    Previous Arrears
                  </td>
                  <td className="border border-slate-300 py-2 px-3">
                    Carried forward balance
                  </td>
                  <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                    {formatINR(activeInvoice.carried_forward_balance)}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold text-base">
                <td colSpan={2} className="border border-slate-300 py-2.5 px-3 text-right">
                  Total Payable to Owner
                </td>
                <td className="border border-slate-300 py-2.5 px-3 text-right font-mono">
                  {formatINR(activeInvoice.total_payable_to_owner)}
                </td>
              </tr>
              <tr>
                <td colSpan={2} className="border border-slate-300 py-2 px-3 text-right">
                  Amount Paid
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(activeInvoice.amount_paid)}
                </td>
              </tr>
              <tr className="font-bold">
                <td colSpan={2} className="border border-slate-300 py-2 px-3 text-right">
                  Balance Due
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(activeInvoice.balance_due)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-6 text-xs text-slate-600 flex justify-between">
            <span>UPI ID: {paymentInfo.merchant_upi_id}</span>
            <span>
              Printed {new Date().toLocaleDateString('en-IN')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
