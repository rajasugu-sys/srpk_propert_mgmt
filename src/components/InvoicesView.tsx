import React, { useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileDown,
  Image as ImageIcon,
  LayoutGrid,
  Lock,
  Pencil,
  Plus,
  Printer,
  Share2,
  Table2,
  X,
} from 'lucide-react';
import {
  AppSettings,
  EbCollectionMode,
  HouseMaintenanceBill,
  InvoiceRecord,
  PaymentStatus,
  PropertyHouse,
  TenantRecord,
  Unit,
  UtilityReading,
} from '../types/estate';
import {
  buildDefaultWaterReference,
  formatBillingMonthLabel,
  formatINR,
  getInvoiceBreakdown,
  isInvoiceLockedStatus,
  resolveEbCollectionMode,
} from '../utils/billingEngine';
import { exportInvoicesSummaryPdf } from '../utils/invoicePdfExport';
import { InvoiceImageTemplate } from './InvoiceImageTemplate';
import { MobileShellHeader } from './MobileShellHeader';

const INVOICES_VIEW_MODE_KEY = 'srpk_invoices_view_mode_v1';
type InvoiceViewMode = 'card' | 'table';

interface InvoicesViewProps {
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  houseMaintenanceBills: HouseMaintenanceBill[];
  utilityReadings: UtilityReading[];
  invoices: InvoiceRecord[];
  settings: AppSettings;
  billingMonth: string;
  selectedPropertyId: string;
  onBack: () => void;
  onChangeSelectedPropertyId: (propertyId: string) => void;
  onChangeBillingMonth: (month: string) => void;
  onCreateInvoice: (invoice: InvoiceRecord) => void;
  onUpdateInvoice: (invoice: InvoiceRecord) => void;
  isReadOnly?: boolean;
}

const ALL_STATUSES: PaymentStatus[] = [
  'Unpaid',
  'Partially Paid',
  'Partially Paid & Closed',
  'Paid & Closed',
];

function getStatusBadgeClasses(status: PaymentStatus): string {
  switch (status) {
    case 'Paid & Closed':
      return 'bg-emerald-50 text-[#3E8E41] border-emerald-200';
    case 'Partially Paid & Closed':
      return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'Partially Paid':
      return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'Unpaid':
    default:
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
}

export const InvoicesView: React.FC<InvoicesViewProps> = ({
  properties,
  units,
  tenants,
  houseMaintenanceBills,
  utilityReadings,
  invoices,
  settings,
  billingMonth,
  selectedPropertyId,
  onBack,
  onChangeSelectedPropertyId,
  onChangeBillingMonth,
  onCreateInvoice,
  onUpdateInvoice,
  isReadOnly = false,
}) => {
  const [floorFilter, setFloorFilter] = useState<string>('ALL');
  const [unitFilter, setUnitFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | PaymentStatus>('ALL');
  const [viewMode, setViewMode] = useState<InvoiceViewMode>(() => {
    try {
      const saved = localStorage.getItem(INVOICES_VIEW_MODE_KEY);
      return saved === 'table' ? 'table' : 'card';
    } catch {
      return 'card';
    }
  });

  const handleChangeViewMode = (mode: InvoiceViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(INVOICES_VIEW_MODE_KEY, mode);
    } catch {
      // Ignore storage write issues
    }
  };

  const [genWarning, setGenWarning] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState<string | null>(null);

  const [viewingInvoiceId, setViewingInvoiceId] = useState<string | null>(null);
  const [printingInvoiceId, setPrintingInvoiceId] = useState<string | null>(null);

  // Non-Editable PNG Invoice Preview & Share Modal State
  const [sharingInvoiceId, setSharingInvoiceId] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const invoiceCaptureRef = useRef<HTMLDivElement | null>(null);

  // Edit / Update Status Modal state (only payment statuses, EB mode & dates are editable)
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<PaymentStatus>('Unpaid');
  const [editAmountPaid, setEditAmountPaid] = useState<string>('0');
  const [editPaidDate, setEditPaidDate] = useState<string>('');
  const [editEbCollectionMode, setEditEbCollectionMode] =
    useState<EbCollectionMode>('Unpaid');
  const [editEbPaidDate, setEditEbPaidDate] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);

  const scopedUnits = useMemo(
    () =>
      selectedPropertyId === 'ALL'
        ? units
        : units.filter((u) => u.property_id === selectedPropertyId),
    [units, selectedPropertyId]
  );

  const availableFloors = useMemo(() => {
    const set = new Set<string>();
    scopedUnits.forEach((u) => set.add(u.floor));
    return Array.from(set);
  }, [scopedUnits]);

  const floorScopedUnits = useMemo(
    () =>
      floorFilter === 'ALL'
        ? scopedUnits
        : scopedUnits.filter((u) => u.floor === floorFilter),
    [scopedUnits, floorFilter]
  );

  const occupiedUnits = useMemo(
    () =>
      floorScopedUnits.filter(
        (u) => u.status === 'OCCUPIED' && Boolean(u.current_tenant_id)
      ),
    [floorScopedUnits]
  );

  const buildInvoiceForUnit = (
    unit: Unit
  ): { invoice?: InvoiceRecord; error?: string } => {
    const property = properties.find((p) => p.property_id === unit.property_id);
    if (!property) {
      return { error: `Parent property missing for unit ${unit.unit_name}.` };
    }

    const tenant = tenants.find(
      (t) => t.id === unit.current_tenant_id && t.is_active
    );
    if (!tenant) {
      return { error: `No active tenant found for ${unit.unit_name}.` };
    }

    // Strict Idempotency Check: UNIQUE(unit_id, tenant_id, billing_month)
    const duplicate = invoices.find(
      (inv) =>
        inv.unit_id === unit.unit_id &&
        inv.tenant_id === tenant.id &&
        inv.billing_month === billingMonth
    );
    if (duplicate) {
      return {
        error: `Duplicate Blocked: Invoice ${duplicate.id} already exists for ${property.property_name} · ${unit.unit_name} (${tenant.full_name}) in ${formatBillingMonthLabel(billingMonth)}.`,
      };
    }

    const reading = utilityReadings.find(
      (r) => r.unit_id === unit.unit_id && r.billing_month === billingMonth
    );

    const rentAmount = tenant.lease_type === 'Lease' ? 0 : tenant.monthly_rent;
    const tenantCleaningFee = tenant.monthly_maintenance_charge;

    const houseMaint = houseMaintenanceBills.find(
      (m) =>
        m.property_id === unit.property_id && m.billing_month === billingMonth
    );
    const unitCount = units.filter((u) => u.property_id === unit.property_id).length;
    const bldgTotal = houseMaint?.total_house_maintenance ?? 0;
    const bldgShare =
      houseMaint && unitCount > 0 ? Math.round(bldgTotal / unitCount) : 0;
    const bldgItems = houseMaint
      ? [
          {
            name: `Common Motor Electricity (${property.utility_provider})`,
            amount: houseMaint.common_eb_amount,
          },
          ...houseMaint.additional_charges.map((c) => ({
            name: c.charge_name,
            amount: c.charge_amount,
          })),
        ]
      : [];

    const ebAmount = reading?.eb_bill_amount ?? 0;
    const ebCollectionMode: EbCollectionMode = 'Unpaid';
    const ebPaidToOwner = false;
    const waterAmount = reading?.water_bill_amount ?? 0;

    // Automatic Balance Carry-Forward from most recent prior Partially Paid & Closed invoice
    const priorInvoices = invoices
      .filter(
        (inv) => inv.tenant_id === tenant.id && inv.billing_month < billingMonth
      )
      .sort((a, b) => b.billing_month.localeCompare(a.billing_month));
    const latestPrior = priorInvoices[0];
    const carriedForwardBalance =
      latestPrior &&
      latestPrior.payment_status === 'Partially Paid & Closed' &&
      latestPrior.balance_due > 0
        ? latestPrior.balance_due
        : 0;

    const totalBillValue =
      rentAmount +
      tenantCleaningFee +
      bldgShare +
      waterAmount +
      ebAmount +
      carriedForwardBalance;
    const totalPayableToOwner =
      rentAmount +
      tenantCleaningFee +
      bldgShare +
      waterAmount +
      (ebPaidToOwner ? ebAmount : 0) +
      carriedForwardBalance;

    const motorBillAmount =
      houseMaint && unitCount > 0 ? Math.round(houseMaint.common_eb_amount / unitCount) : 0;
    const othersAmount = Math.max(0, bldgShare - motorBillAmount) + carriedForwardBalance;

    const waterPrev1 = reading?.prev_reading_1 ?? unit.last_water_reading_1;
    const waterCurr1 = reading?.curr_reading_1 ?? unit.last_water_reading_1;
    const waterPrev2 = reading?.prev_reading_2 ?? unit.last_water_reading_2;
    const waterCurr2 = reading?.curr_reading_2 ?? unit.last_water_reading_2;

    const invId = `INV-${billingMonth.replace('-', '')}-${unit.unit_id.replace('UNIT-', '')}`;
    const invoice: InvoiceRecord = {
      id: invId,
      property_id: property.property_id,
      property_name: property.property_name,
      unit_id: unit.unit_id,
      tenant_id: tenant.id,
      billing_month: billingMonth,
      unit_name: unit.unit_name,
      unit_type: unit.unit_type,
      floor: unit.floor,
      tenant_name: tenant.full_name,
      whatsapp_phone: tenant.whatsapp_phone,
      lease_type: tenant.lease_type,
      rent_amount: rentAmount,
      tenant_cleaning_fee: tenantCleaningFee,
      building_maintenance_total: bldgTotal,
      building_unit_count: unitCount,
      building_maintenance_share: bldgShare,
      building_maintenance_items: bldgItems,
      eb_amount: ebAmount,
      eb_paid_to_owner: ebPaidToOwner,
      eb_collection_mode: ebCollectionMode,
      eb_paid_date: null,
      water_prev_1: waterPrev1,
      water_curr_1: waterCurr1,
      water_prev_2: waterPrev2,
      water_curr_2: waterCurr2,
      water_net_units: reading?.net_consumption ?? 0,
      water_rate: reading?.water_rate ?? tenant.water_charge,
      water_amount: waterAmount,
      carried_forward_balance: carriedForwardBalance,
      total_bill_value: totalBillValue,
      total_payable_to_owner: totalPayableToOwner,
      amount_paid: 0,
      balance_due: totalPayableToOwner,
      payment_status: 'Unpaid',
      is_locked: false,
      keb_account_id: unit.eb_rr_number,
      water_reference: buildDefaultWaterReference({
        waterRr1: unit.water_rr_number,
        waterRr2: unit.water_rr_number2,
        prev1: waterPrev1,
        curr1: waterCurr1,
        prev2: waterPrev2,
        curr2: waterCurr2,
      }),
      motor_bill_amount: motorBillAmount,
      others_amount: othersAmount,
      generated_at: new Date().toISOString(),
      paid_at: null,
      closed_at: null,
    };

    return { invoice };
  };

  const handleGenerateSingle = () => {
    setGenWarning(null);
    setGenSuccess(null);

    let targetUnit: Unit | undefined;
    if (unitFilter !== 'ALL') {
      targetUnit = units.find((u) => u.unit_id === unitFilter);
      if (!targetUnit) return;
      if (targetUnit.status !== 'OCCUPIED' || !targetUnit.current_tenant_id) {
        setGenWarning(
          `${targetUnit.unit_name} is currently VACANT. Onboard a tenant before generating a bill.`
        );
        return;
      }
    } else {
      const unbilled = occupiedUnits.find(
        (u) =>
          !invoices.some(
            (inv) =>
              inv.unit_id === u.unit_id &&
              inv.tenant_id === u.current_tenant_id &&
              inv.billing_month === billingMonth
          )
      );
      targetUnit = unbilled || occupiedUnits[0];
    }

    if (!targetUnit) {
      setGenWarning('No occupied units found in the selected House / Floor filter.');
      return;
    }

    const result = buildInvoiceForUnit(targetUnit);
    if (result.error) {
      setGenWarning(result.error);
      return;
    }
    if (result.invoice) {
      onCreateInvoice(result.invoice);
      setGenSuccess(
        `Generated invoice ${result.invoice.id} for ${result.invoice.property_name} · ${targetUnit.unit_name} (${formatINR(
          result.invoice.total_payable_to_owner
        )} payable to owner${
          result.invoice.carried_forward_balance > 0
            ? `, incl. ${formatINR(result.invoice.carried_forward_balance)} arrears`
            : ''
        }).`
      );
    }
  };

  const handleGenerateAllMissing = () => {
    setGenWarning(null);
    setGenSuccess(null);
    let createdCount = 0;
    let skippedCount = 0;

    const targetPool =
      unitFilter !== 'ALL'
        ? occupiedUnits.filter((u) => u.unit_id === unitFilter)
        : occupiedUnits;

    targetPool.forEach((unit) => {
      const res = buildInvoiceForUnit(unit);
      if (res.invoice) {
        onCreateInvoice(res.invoice);
        createdCount++;
      } else {
        skippedCount++;
      }
    });

    if (createdCount === 0 && skippedCount > 0) {
      setGenWarning(
        `All ${skippedCount} occupied unit(s) already have invoices for ${formatBillingMonthLabel(
          billingMonth
        )}. Duplicate creation prevented.`
      );
    } else {
      setGenSuccess(
        `Generated ${createdCount} new invoice(s) for ${formatBillingMonthLabel(
          billingMonth
        )}${skippedCount > 0 ? ` (${skippedCount} existing skipped to prevent duplicates)` : ''}.`
      );
    }
  };

  const openEditStatusModal = (inv: InvoiceRecord) => {
    if (inv.is_locked) return;
    const resolvedMode = resolveEbCollectionMode(inv);
    const todayIso = new Date().toISOString().slice(0, 10);

    setEditingInvoiceId(inv.id);
    setEditStatus(inv.payment_status);
    setEditAmountPaid(String(inv.amount_paid || 0));
    setEditPaidDate(inv.paid_at ? String(inv.paid_at).slice(0, 10) : '');
    setEditEbCollectionMode(resolvedMode);
    setEditEbPaidDate(
      resolvedMode === 'Unpaid'
        ? ''
        : inv.eb_paid_date
          ? String(inv.eb_paid_date).slice(0, 10)
          : todayIso
    );
    setEditError(null);
  };

  const editingInvoice = useMemo(
    () => invoices.find((inv) => inv.id === editingInvoiceId) || null,
    [invoices, editingInvoiceId]
  );

  const editingBreakdown = useMemo(
    () => (editingInvoice ? getInvoiceBreakdown(editingInvoice) : null),
    [editingInvoice]
  );

  const editingUnit = useMemo(
    () =>
      editingInvoice
        ? units.find((u) => u.unit_id === editingInvoice.unit_id) || null
        : null,
    [units, editingInvoice]
  );

  const editPreviewTotalPayable = useMemo(() => {
    if (!editingInvoice || !editingBreakdown) return 0;
    return (
      editingBreakdown.totalAmount +
      (editEbCollectionMode === 'Paid to Owner' ? editingBreakdown.eb : 0)
    );
  }, [editingInvoice, editingBreakdown, editEbCollectionMode]);

  const handleSaveStatusUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvoice || editingInvoice.is_locked) return;
    setEditError(null);

    let nextPaid = 0;
    if (editStatus === 'Unpaid') {
      nextPaid = 0;
    } else if (editStatus === 'Paid & Closed') {
      nextPaid = editPreviewTotalPayable;
    } else {
      const parsed = Number(editAmountPaid);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setEditError('Enter a valid Amount Paid (0 or more).');
        return;
      }
      if (parsed > editPreviewTotalPayable) {
        setEditError(
          `Amount Paid cannot exceed Total Payable to Owner (${formatINR(
            editPreviewTotalPayable
          )}).`
        );
        return;
      }
      if (editStatus === 'Partially Paid & Closed' && parsed >= editPreviewTotalPayable) {
        setEditError(
          'Remaining balance is ₹0 — choose "Paid & Closed" instead.'
        );
        return;
      }
      nextPaid = Math.round(parsed);
    }

    const nextBalance =
      editStatus === 'Paid & Closed'
        ? 0
        : Math.max(0, editPreviewTotalPayable - nextPaid);
    const nextLocked = isInvoiceLockedStatus(editStatus);
    const todayIso = new Date().toISOString().slice(0, 10);
    const nextEbPaidToOwner = editEbCollectionMode === 'Paid to Owner';
    const nextEbPaidDate =
      editEbCollectionMode === 'Unpaid'
        ? null
        : editEbPaidDate.trim() || todayIso;

    const updated: InvoiceRecord = {
      ...editingInvoice,
      eb_collection_mode: editEbCollectionMode,
      eb_paid_to_owner: nextEbPaidToOwner,
      eb_paid_date: nextEbPaidDate,
      total_payable_to_owner: editPreviewTotalPayable,
      amount_paid: nextPaid,
      balance_due: nextBalance,
      payment_status: editStatus,
      is_locked: nextLocked,
      paid_at:
        nextPaid > 0
          ? editPaidDate.trim() || editingInvoice.paid_at || todayIso
          : null,
      closed_at: nextLocked ? todayIso : null,
    };

    onUpdateInvoice(updated);
    setEditingInvoiceId(null);
  };

  const filteredInvoices = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (billingMonth && inv.billing_month !== billingMonth) return false;
        if (selectedPropertyId !== 'ALL' && inv.property_id !== selectedPropertyId) {
          return false;
        }
        if (floorFilter !== 'ALL' && inv.floor !== floorFilter) return false;
        if (unitFilter !== 'ALL' && inv.unit_id !== unitFilter) return false;
        if (statusFilter !== 'ALL' && inv.payment_status !== statusFilter) return false;
        return true;
      })
      .sort((a, b) =>
        `${a.property_name}-${a.unit_name}`.localeCompare(
          `${b.property_name}-${b.unit_name}`
        )
      );
  }, [
    invoices,
    billingMonth,
    selectedPropertyId,
    floorFilter,
    unitFilter,
    statusFilter,
  ]);

  const activeModalInvoice = useMemo(
    () => invoices.find((inv) => inv.id === viewingInvoiceId) || null,
    [invoices, viewingInvoiceId]
  );

  const sharingInvoice = useMemo(
    () => invoices.find((inv) => inv.id === sharingInvoiceId) || null,
    [invoices, sharingInvoiceId]
  );

  const sharingUnit = useMemo(
    () =>
      sharingInvoice
        ? units.find((u) => u.unit_id === sharingInvoice.unit_id) || null
        : null,
    [units, sharingInvoice]
  );

  const printableInvoice = useMemo(
    () =>
      invoices.find((inv) => inv.id === (printingInvoiceId || viewingInvoiceId)) ||
      null,
    [invoices, printingInvoiceId, viewingInvoiceId]
  );

  const triggerPrint = (invoiceId: string) => {
    setPrintingInvoiceId(invoiceId);
    setTimeout(() => {
      window.print();
    }, 80);
  };

  const openShareImageModal = (invoice: InvoiceRecord) => {
    setShareFeedback(null);
    setSharingInvoiceId(invoice.id);
  };

  const captureInvoicePngBlob = async (): Promise<{
    blob: Blob;
    fileName: string;
  } | null> => {
    if (!invoiceCaptureRef.current || !sharingInvoice) return null;
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    const canvas = await html2canvas(invoiceCaptureRef.current, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) return null;
    const safeTenant = sharingInvoice.tenant_name
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const fileName = `${safeTenant || sharingInvoice.unit_name}_${
      sharingInvoice.billing_month
    }_Invoice.png`;
    return { blob, fileName };
  };

  const triggerPngDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleDownloadInvoicePng = async () => {
    if (isGeneratingImage || !sharingInvoice) return;
    setIsGeneratingImage(true);
    setShareFeedback(null);
    try {
      const captured = await captureInvoicePngBlob();
      if (!captured) {
        setShareFeedback('Could not generate invoice image. Please try again.');
        return;
      }
      triggerPngDownload(captured.blob, captured.fileName);
      setShareFeedback(`Saved ${captured.fileName}`);
    } catch {
      setShareFeedback('Could not render invoice PNG. Please retry.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleShareInvoicePng = async () => {
    if (isGeneratingImage || !sharingInvoice) return;
    setIsGeneratingImage(true);
    setShareFeedback(null);
    try {
      const captured = await captureInvoicePngBlob();
      if (!captured) {
        setShareFeedback('Could not generate invoice image. Please try again.');
        return;
      }
      const file = new File([captured.blob], captured.fileName, {
        type: 'image/png',
      });
      const canNativeShareFiles =
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        (!navigator.canShare || navigator.canShare({ files: [file] }));

      if (canNativeShareFiles) {
        try {
          await navigator.share({
            files: [file],
            title: `${sharingInvoice.tenant_name} — ${formatBillingMonthLabel(
              sharingInvoice.billing_month
            )} Invoice`,
          });
          setShareFeedback('Invoice image shared.');
          return;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            return;
          }
          // Fall back to direct download if browser blocks file share
        }
      }

      triggerPngDownload(captured.blob, captured.fileName);
      setShareFeedback(
        'PNG downloaded — attach this image directly in WhatsApp!'
      );
    } catch {
      setShareFeedback('Could not share invoice image. Please try Download PNG.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  return (
    <div>
      <div className="print:hidden">
        <MobileShellHeader
          title="Invoices"
          subtitle={`Billing, EB Mode & PNG Invoices · ${formatBillingMonthLabel(billingMonth)}`}
          onBack={onBack}
          rightSlot={
            <select
              aria-label="Billing Month"
              value={billingMonth}
              onChange={(e) => onChangeBillingMonth(e.target.value)}
              className="rounded-xl bg-white/15 border border-white/25 px-2.5 py-1.5 text-xs font-bold text-white cursor-pointer"
            >
              <option value="2026-12" className="text-slate-900">
                Dec 2026
              </option>
              <option value="2026-11" className="text-slate-900">
                Nov 2026
              </option>
              <option value="2026-10" className="text-slate-900">
                Oct 2026
              </option>
            </select>
          }
        />

        {/* Curved White Lower Sheet */}
        <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[calc(100vh-120px)] space-y-4">
          {/* Consolidated 3 Cascading Filters + Duplicate-Safe Generator */}
          <section className="rounded-2xl border border-gray-100 bg-gray-50/80 p-3.5 space-y-3">
            <div className="min-w-0">
              <h2 className="text-xs font-bold text-[#0f172a]">
                Monthly Tenant Bill Generator
              </h2>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                Rent + Cleaning + Bldg Share + Water + EB + Carried Arrears
              </p>
            </div>

            {/* 3 Cascading Filter Dropdowns consolidated cleanly above Generate actions */}
            <div className="space-y-2">
              <select
                aria-label="Filter Invoices by House"
                value={selectedPropertyId}
                onChange={(e) => {
                  onChangeSelectedPropertyId(e.target.value);
                  setFloorFilter('ALL');
                  setUnitFilter('ALL');
                }}
                className="w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[38px]"
              >
                <option value="ALL">All Houses ({properties.length})</option>
                {properties.map((p) => (
                  <option key={p.property_id} value={p.property_id}>
                    {p.property_name}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="Filter Invoices by Floor"
                  value={floorFilter}
                  onChange={(e) => {
                    setFloorFilter(e.target.value);
                    setUnitFilter('ALL');
                  }}
                  className="w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[38px]"
                >
                  <option value="ALL">All Floors</option>
                  {availableFloors.map((fl) => (
                    <option key={fl} value={fl}>
                      {fl}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Invoices by Unit"
                  value={unitFilter}
                  onChange={(e) => setUnitFilter(e.target.value)}
                  className="w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[38px]"
                >
                  <option value="ALL">All Units ({floorScopedUnits.length})</option>
                  {floorScopedUnits.map((u) => (
                    <option key={u.unit_id} value={u.unit_id}>
                      {u.unit_name} ({u.status === 'OCCUPIED' ? 'Occ' : 'Vac'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!isReadOnly && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleGenerateSingle}
                  disabled={occupiedUnits.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#3E8E41] disabled:opacity-50 cursor-pointer min-h-[40px]"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {unitFilter !== 'ALL'
                      ? `Generate (${
                          units.find((u) => u.unit_id === unitFilter)?.unit_name || 'Unit'
                        })`
                      : 'Generate Unit Bill'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleGenerateAllMissing}
                  disabled={occupiedUnits.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0f172a] px-3 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer min-h-[40px]"
                >
                  <span className="truncate">Generate All Missing</span>
                </button>
              </div>
            )}

            {genWarning && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] font-semibold text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{genWarning}</span>
              </div>
            )}

            {genSuccess && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[11px] font-semibold text-[#3E8E41]">
                <CheckCircle2 className="w-4 h-4 text-[#489E44] shrink-0 mt-0.5" />
                <span>{genSuccess}</span>
              </div>
            )}
          </section>

          {/* Payment Status Filter Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {(['ALL', ...ALL_STATUSES] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-[11px] font-bold rounded-xl border cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                  statusFilter === st
                    ? 'bg-[#489E44] text-white border-[#489E44]'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* View Mode Switcher (Card vs. Table) + Export PDF Action */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-100 bg-gray-50/80 px-3 py-2">
            <div className="text-xs font-bold text-[#0f172a]">
              {filteredInvoices.length} Invoice{filteredInvoices.length === 1 ? '' : 's'}
            </div>

            <div className="flex items-center gap-2">
              <div
                className="inline-flex rounded-xl bg-gray-200/80 p-0.5"
                role="group"
                aria-label="Invoice display view"
              >
                <button
                  type="button"
                  onClick={() => handleChangeViewMode('card')}
                  aria-pressed={viewMode === 'card'}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer transition-colors ${
                    viewMode === 'card'
                      ? 'bg-white text-[#3E8E41] shadow-2xs'
                      : 'text-gray-600 hover:text-[#0f172a]'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleChangeViewMode('table')}
                  aria-pressed={viewMode === 'table'}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold cursor-pointer transition-colors ${
                    viewMode === 'table'
                      ? 'bg-white text-[#3E8E41] shadow-2xs'
                      : 'text-gray-600 hover:text-[#0f172a]'
                  }`}
                >
                  <Table2 className="w-3.5 h-3.5" />
                  <span>Table</span>
                </button>
              </div>

              <button
                type="button"
                disabled={filteredInvoices.length === 0}
                onClick={() => {
                  const selectedHouseName =
                    selectedPropertyId === 'ALL'
                      ? 'All Houses'
                      : properties.find((p) => p.property_id === selectedPropertyId)
                          ?.property_name || selectedPropertyId;
                  const summaryParts = [
                    `Month: ${formatBillingMonthLabel(billingMonth)}`,
                    `House: ${selectedHouseName}`,
                    floorFilter !== 'ALL' ? `Floor: ${floorFilter}` : null,
                    unitFilter !== 'ALL'
                      ? `Unit: ${
                          units.find((u) => u.unit_id === unitFilter)?.unit_name ||
                          unitFilter
                        }`
                      : null,
                    statusFilter !== 'ALL' ? `Status: ${statusFilter}` : null,
                  ].filter(Boolean);

                  exportInvoicesSummaryPdf({
                    invoices: filteredInvoices,
                    filterSummary: summaryParts.join('  |  '),
                    fileName: `SRKP-Invoices-${billingMonth}.pdf`,
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#0f172a] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer min-h-[34px]"
              >
                <FileDown className="w-3.5 h-3.5 text-emerald-300" />
                <span>Export PDF</span>
              </button>
            </div>
          </div>

          {/* Invoice List: Card View or Compact Tabular View */}
          {filteredInvoices.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-8 text-center text-xs text-gray-500">
              No invoices found for the selected House, Floor/Unit, Month, and Payment Status.
            </div>
          ) : viewMode === 'table' ? (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-[#3E8E41] text-white text-[11px] font-bold">
                      <th className="py-2.5 px-3 whitespace-nowrap">Unit / Tenant</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Month &amp; Year</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Rent</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Water</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Maintenance</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Motor</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Others</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Total Amount</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">
                        KEB (BESCOM) Bill
                      </th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Paid Date / Status</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredInvoices.map((inv) => {
                      const b = getInvoiceBreakdown(inv);
                      return (
                        <tr
                          key={inv.id}
                          className="hover:bg-emerald-50/35 transition-colors align-middle"
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-[#0f172a] whitespace-nowrap">
                              {inv.unit_name} ({inv.floor})
                            </div>
                            <div className="text-[11px] text-gray-600 truncate max-w-[170px]">
                              {inv.tenant_name}
                            </div>
                            <div className="text-[10px] text-[#3E8E41] truncate max-w-[170px]">
                              {inv.property_name}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap font-medium text-gray-700">
                            {formatBillingMonthLabel(inv.billing_month)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-[#0f172a]">
                            {formatINR(b.rent)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-[#0f172a]">
                            {formatINR(b.water)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-[#0f172a]">
                            {formatINR(b.cleaning)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-[#0f172a]">
                            {formatINR(b.motor)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-[#0f172a]">
                            {formatINR(b.others)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap font-extrabold text-[#3E8E41]">
                            {formatINR(b.totalAmount)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="font-mono tabular-nums font-semibold text-[#0f172a]">
                              {formatINR(b.eb)}
                            </div>
                            <span
                              className={`mt-0.5 inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                                b.ebCollectionMode === 'Paid to Owner'
                                  ? 'border-emerald-200 bg-emerald-50 text-[#3E8E41]'
                                  : b.ebCollectionMode === 'Paid Directly'
                                    ? 'border-gray-200 bg-gray-100 text-gray-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-800'
                              }`}
                            >
                              {b.ebCollectionMode}
                            </span>
                            {b.ebPaidDateLabel && (
                              <div className="mt-0.5 text-[10px] font-mono text-gray-500">
                                {b.ebPaidDateLabel}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold ${getStatusBadgeClasses(
                                inv.payment_status
                              )}`}
                            >
                              {inv.is_locked ? (
                                <Lock className="w-2.5 h-2.5" />
                              ) : (
                                <Clock className="w-2.5 h-2.5" />
                              )}
                              <span>{inv.payment_status}</span>
                            </span>
                            <div className="mt-1 text-[10px] font-mono text-gray-500">
                              {b.paidDateLabel ? `Paid: ${b.paidDateLabel}` : 'Not Paid'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {!isReadOnly && (
                                <button
                                  type="button"
                                  disabled={inv.is_locked}
                                  onClick={() => openEditStatusModal(inv)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#0f172a] hover:bg-gray-50 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  {inv.is_locked ? (
                                    <Lock className="w-3 h-3 text-gray-400" />
                                  ) : (
                                    <Pencil className="w-3 h-3 text-[#489E44]" />
                                  )}
                                  <span>{inv.is_locked ? 'Locked' : 'Update Status'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openShareImageModal(inv)}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#489E44] px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-[#3E8E41] cursor-pointer"
                              >
                                <ImageIcon className="w-3 h-3" />
                                <span>Share PNG</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {(() => {
                      const totals = filteredInvoices.reduce(
                        (acc, inv) => {
                          const b = getInvoiceBreakdown(inv);
                          acc.rent += b.rent;
                          acc.water += b.water;
                          acc.cleaning += b.cleaning;
                          acc.motor += b.motor;
                          acc.others += b.others;
                          acc.totalAmount += b.totalAmount;
                          acc.eb += b.eb;
                          return acc;
                        },
                        {
                          rent: 0,
                          water: 0,
                          cleaning: 0,
                          motor: 0,
                          others: 0,
                          totalAmount: 0,
                          eb: 0,
                        }
                      );
                      return (
                        <tr className="bg-emerald-50/90 border-t-2 border-[#3E8E41]/30 font-extrabold text-[#0f172a]">
                          <td className="py-2.5 px-3 whitespace-nowrap" colSpan={2}>
                            TOTAL ({filteredInvoices.length})
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            {formatINR(totals.rent)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            {formatINR(totals.water)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            {formatINR(totals.cleaning)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            {formatINR(totals.motor)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            {formatINR(totals.others)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-[#3E8E41]">
                            {formatINR(totals.totalAmount)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            {formatINR(totals.eb)}
                          </td>
                          <td className="py-2.5 px-3" colSpan={2} />
                        </tr>
                      );
                    })()}
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredInvoices.map((inv) => {
                const b = getInvoiceBreakdown(inv);
                return (
                  <article
                    key={inv.id}
                    className="rounded-2xl border border-gray-100 bg-white p-4 shadow-xs space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-[#3E8E41] truncate">
                          {inv.property_name}
                        </div>
                        <div className="font-bold text-sm text-[#0f172a]">
                          {inv.unit_name} ({inv.unit_type} · {inv.floor})
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {inv.tenant_name} · {inv.lease_type}
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold whitespace-nowrap shrink-0 ${getStatusBadgeClasses(
                          inv.payment_status
                        )}`}
                      >
                        {inv.is_locked ? (
                          <Lock className="w-3 h-3" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        <span>{inv.payment_status}</span>
                      </span>
                    </div>

                    {inv.carried_forward_balance > 0 && (
                      <div className="inline-flex items-center rounded-lg bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-700 font-mono tabular-nums">
                        + Carried Arrears: {formatINR(inv.carried_forward_balance)}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-100 bg-gray-50/80 p-3 text-xs">
                      <div>
                        <div className="text-[10px] text-gray-500">Rent</div>
                        <div className="font-mono tabular-nums font-semibold text-[#0f172a]">
                          {formatINR(inv.rent_amount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500">Cleaning Fee</div>
                        <div className="font-mono tabular-nums font-semibold text-[#0f172a]">
                          {formatINR(inv.tenant_cleaning_fee)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500">
                          Bldg Maint
                          {inv.building_unit_count > 0
                            ? ` (÷${inv.building_unit_count})`
                            : ''}
                        </div>
                        <div className="font-mono tabular-nums font-semibold text-[#0f172a]">
                          {formatINR(inv.building_maintenance_share)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500">
                          Water ({inv.water_net_units}u)
                        </div>
                        <div className="font-mono tabular-nums font-semibold text-[#0f172a]">
                          {formatINR(inv.water_amount)}
                        </div>
                      </div>
                      <div className="col-span-2 pt-2 border-t border-gray-200 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[10px] text-gray-500">Unit EB</div>
                          <div className="font-mono tabular-nums font-semibold text-[#0f172a]">
                            {formatINR(inv.eb_amount)}
                          </div>
                        </div>
                        <div className="text-right">
                          <span
                            className={`inline-flex items-center rounded-lg border px-2 py-1 text-[10px] font-bold ${
                              b.ebCollectionMode === 'Paid to Owner'
                                ? 'border-emerald-200 bg-emerald-50 text-[#3E8E41]'
                                : b.ebCollectionMode === 'Paid Directly'
                                  ? 'border-gray-200 bg-white text-gray-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-800'
                            }`}
                          >
                            EB: {b.ebCollectionMode}
                          </span>
                          {b.ebPaidDateLabel && (
                            <div className="mt-0.5 text-[10px] font-mono text-gray-500">
                              EB Paid: {b.ebPaidDateLabel}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 rounded-xl bg-gradient-to-r from-[#3E8E41] to-[#489E44] px-3.5 py-2.5 text-white">
                      <div>
                        <div className="text-[10px] text-emerald-100">
                          Payable to Owner
                        </div>
                        <div className="text-base font-extrabold font-mono tabular-nums">
                          {formatINR(inv.total_payable_to_owner)}
                        </div>
                      </div>
                      {(inv.amount_paid > 0 || inv.balance_due > 0) && (
                        <div className="text-right font-mono tabular-nums text-[11px]">
                          {inv.amount_paid > 0 && (
                            <div className="text-emerald-100 font-semibold">
                              Paid: {formatINR(inv.amount_paid)}
                            </div>
                          )}
                          {inv.balance_due > 0 && inv.amount_paid > 0 && (
                            <div className="text-[#FACC15] font-extrabold">
                              Due: {formatINR(inv.balance_due)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {!isReadOnly && (
                        <button
                          type="button"
                          disabled={inv.is_locked}
                          onClick={() => openEditStatusModal(inv)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#0f172a] hover:bg-gray-50 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer min-h-[38px]"
                        >
                          {inv.is_locked ? (
                            <Lock className="w-3.5 h-3.5 text-gray-400" />
                          ) : (
                            <Pencil className="w-3.5 h-3.5 text-[#489E44]" />
                          )}
                          <span>{inv.is_locked ? 'Locked' : 'Update Status'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setViewingInvoiceId(inv.id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#0f172a] hover:bg-gray-50 cursor-pointer min-h-[38px]"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#489E44]" />
                        <span>View</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => triggerPrint(inv.id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#0f172a] hover:bg-gray-50 cursor-pointer min-h-[38px]"
                      >
                        <Printer className="w-3.5 h-3.5 text-gray-600" />
                        <span>Print</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openShareImageModal(inv)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3 py-2 text-xs font-bold text-white hover:bg-[#3E8E41] cursor-pointer min-h-[38px]"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>Share PNG</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Edit / Update Status & EB Collection Mode Modal */}
      {editingInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-3 print:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div>
                <div className="text-xs font-mono text-[#3E8E41] font-semibold">
                  {editingInvoice.id} · {formatBillingMonthLabel(editingInvoice.billing_month)}
                </div>
                <h3 className="text-base font-bold text-[#0f172a] mt-0.5">
                  Update Status — {editingInvoice.tenant_name}
                </h3>
                <p className="text-xs text-gray-500">
                  {editingInvoice.property_name} · {editingInvoice.unit_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingInvoiceId(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"
                aria-label="Close status update modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStatusUpdate} className="space-y-4">
              {/* Read-Only Invoice Image Breakdown Summary */}
              {editingBreakdown && (
                <div className="rounded-xl border border-gray-200 bg-gray-50/90 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#0f172a]">
                      Invoice Breakdown (Read-Only)
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                      <Lock className="w-2.5 h-2.5" />
                      <span>Locked</span>
                    </span>
                  </div>

                  {(() => {
                    const waterRefText =
                      editingInvoice.water_reference &&
                      editingInvoice.water_reference.trim() !== ''
                        ? editingInvoice.water_reference.trim()
                        : buildDefaultWaterReference({
                            waterRr1: editingUnit?.water_rr_number,
                            waterRr2: editingUnit?.water_rr_number2,
                            prev1: editingInvoice.water_prev_1,
                            curr1: editingInvoice.water_curr_1,
                            prev2: editingInvoice.water_prev_2,
                            curr2: editingInvoice.water_curr_2,
                          });
                    const kebAccIdText = (
                      editingInvoice.keb_account_id ||
                      editingUnit?.eb_rr_number ||
                      ''
                    ).trim();

                    return (
                      <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 text-xs">
                        <div className="flex items-center justify-between px-2.5 py-1.5">
                          <span className="text-gray-600">Rent</span>
                          <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                            {formatINR(editingBreakdown.rent)}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-2 px-2.5 py-1.5">
                          <div className="min-w-0">
                            <div className="text-gray-600">Water Bill</div>
                            {waterRefText && (
                              <div className="text-[10px] font-mono text-gray-400 break-all">
                                {waterRefText}
                              </div>
                            )}
                          </div>
                          <span className="font-mono tabular-nums font-semibold text-[#0f172a] shrink-0">
                            {formatINR(editingBreakdown.water)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between px-2.5 py-1.5">
                          <span className="text-gray-600">Maintenance (Cleaning)</span>
                          <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                            {formatINR(editingBreakdown.cleaning)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between px-2.5 py-1.5">
                          <span className="text-gray-600">Motor Bill</span>
                          <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                            {formatINR(editingBreakdown.motor)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between px-2.5 py-1.5">
                          <span className="text-gray-600">Others</span>
                          <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                            {formatINR(editingBreakdown.others)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between px-2.5 py-2 bg-emerald-50/70 font-bold">
                          <span className="text-[#0f172a]">Total Amount</span>
                          <span className="font-mono tabular-nums text-[#3E8E41]">
                            {formatINR(editingBreakdown.totalAmount)}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-2 px-2.5 py-1.5">
                          <div className="min-w-0">
                            <div className="text-gray-600">KEB (BESCOM) Bill</div>
                            <div className="text-[10px] font-mono text-gray-400">
                              Acc ID: {kebAccIdText || 'N/A'}
                            </div>
                          </div>
                          <span className="font-mono tabular-nums font-semibold text-[#0f172a] shrink-0">
                            {formatINR(editingBreakdown.eb)}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* EB Collection Mode (3 options) & Conditional Paid Date */}
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2.5">
                <div className="text-xs font-bold text-[#0f172a]">
                  EB Collection Mode (Unit EB: {formatINR(editingInvoice.eb_amount)})
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-gray-200/80">
                  {(['Unpaid', 'Paid to Owner', 'Paid Directly'] as const).map(
                    (mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setEditEbCollectionMode(mode);
                          if (mode === 'Unpaid') {
                            setEditEbPaidDate('');
                          } else {
                            setEditEbPaidDate((prev) =>
                              prev.trim() ? prev : new Date().toISOString().slice(0, 10)
                            );
                          }
                        }}
                        className={`py-2 px-1.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                          editEbCollectionMode === mode
                            ? mode === 'Paid to Owner'
                              ? 'bg-white text-[#3E8E41] shadow-xs'
                              : mode === 'Paid Directly'
                                ? 'bg-white text-[#0f172a] shadow-xs'
                                : 'bg-white text-amber-700 shadow-xs'
                            : 'text-gray-600 hover:text-[#0f172a]'
                        }`}
                      >
                        {mode}
                      </button>
                    )
                  )}
                </div>

                {(editEbCollectionMode === 'Paid to Owner' ||
                  editEbCollectionMode === 'Paid Directly') && (
                  <div className="pt-1">
                    <label
                      htmlFor="eb-paid-date-input"
                      className="block text-[11px] font-semibold text-gray-700 mb-1"
                    >
                      EB Paid Date
                    </label>
                    <input
                      id="eb-paid-date-input"
                      type="date"
                      value={editEbPaidDate}
                      onChange={(e) => setEditEbPaidDate(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-mono text-[#0f172a] min-h-[40px]"
                    />
                  </div>
                )}
              </div>

              {/* 4 Exact Payment Statuses */}
              <div>
                <label className="block text-xs font-bold text-[#0f172a] mb-2">
                  Invoice Payment Status
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        setEditStatus(st);
                        if (st === 'Unpaid') setEditAmountPaid('0');
                        if (st === 'Paid & Closed') {
                          setEditAmountPaid(String(editPreviewTotalPayable));
                        }
                      }}
                      className={`text-left px-3 py-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                        editStatus === st
                          ? 'border-[#489E44] bg-emerald-50 text-[#3E8E41]'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span>{st}</span>
                        {isInvoiceLockedStatus(st) && (
                          <Lock className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {(editStatus === 'Partially Paid' ||
                editStatus === 'Partially Paid & Closed') && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Amount Paid by Tenant (INR) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={editPreviewTotalPayable}
                    value={editAmountPaid}
                    onChange={(e) => setEditAmountPaid(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm font-mono tabular-nums font-bold text-[#0f172a] min-h-[44px]"
                  />
                </div>
              )}

              {editStatus !== 'Unpaid' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Paid Date (Shown on PNG Invoice)
                  </label>
                  <input
                    type="date"
                    value={editPaidDate}
                    onChange={(e) => setEditPaidDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
                  />
                </div>
              )}

              {/* Live Totals Summary */}
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Payable to Owner</span>
                  <span className="font-mono tabular-nums font-bold text-[#0f172a]">
                    {formatINR(editPreviewTotalPayable)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Amount Paid</span>
                  <span className="font-mono tabular-nums font-semibold text-[#3E8E41]">
                    {formatINR(
                      editStatus === 'Unpaid'
                        ? 0
                        : editStatus === 'Paid & Closed'
                          ? editPreviewTotalPayable
                          : Number(editAmountPaid) || 0
                    )}
                  </span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-gray-200 font-bold text-sm">
                  <span className="text-[#0f172a]">Remaining Balance Due</span>
                  <span className="font-mono tabular-nums text-[#3E8E41]">
                    {formatINR(
                      editStatus === 'Paid & Closed'
                        ? 0
                        : Math.max(
                            0,
                            editPreviewTotalPayable -
                              (editStatus === 'Unpaid'
                                ? 0
                                : Number(editAmountPaid) || 0)
                          )
                    )}
                  </span>
                </div>
              </div>

              {isInvoiceLockedStatus(editStatus) && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Permanent Lock Warning:</strong> Setting status to{' '}
                    <strong>{editStatus}</strong> permanently locks this invoice from future
                    edits, status changes, and auto-recalculations.
                    {editStatus === 'Partially Paid & Closed' && (
                      <span>
                        {' '}
                        The remaining balance will carry forward into the tenant&apos;s next
                        month&apos;s invoice (or Move-Out Settlement).
                      </span>
                    )}
                  </div>
                </div>
              )}

              {editError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingInvoiceId(null)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#489E44] px-4 py-2 text-xs font-bold text-white hover:bg-[#3E8E41] cursor-pointer min-h-[40px]"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Status</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Itemized Invoice View Modal */}
      {activeModalInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-3 print:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div className="min-w-0">
                <div className="text-xs font-mono text-gray-500">
                  {activeModalInvoice.id} ·{' '}
                  {formatBillingMonthLabel(activeModalInvoice.billing_month)} ·{' '}
                  <span className="font-bold text-[#3E8E41]">
                    {activeModalInvoice.payment_status}
                  </span>
                </div>
                <h3 className="text-base font-bold text-[#0f172a] mt-0.5 break-words">
                  {activeModalInvoice.property_name} · {activeModalInvoice.unit_name} (
                  {activeModalInvoice.floor}) — {activeModalInvoice.tenant_name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingInvoiceId(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer shrink-0"
                aria-label="Close invoice modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Itemized Ledger Breakdown */}
            <div className="space-y-3 text-xs">
              <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                <div className="flex justify-between px-3.5 py-2.5 bg-white">
                  <span className="text-gray-600">
                    {activeModalInvoice.lease_type === 'Rental'
                      ? 'Monthly Rent'
                      : 'Lease Agreement (₹0 Rent)'}
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                    {formatINR(activeModalInvoice.rent_amount)}
                  </span>
                </div>

                <div className="flex justify-between px-3.5 py-2.5 bg-white">
                  <div>
                    <div className="text-gray-700 font-medium">
                      Monthly Cleaning Fee (Fixed Tenant Maint)
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Agreed fixed monthly cleaning charge
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                    {formatINR(activeModalInvoice.tenant_cleaning_fee)}
                  </span>
                </div>

                <div className="flex justify-between px-3.5 py-2.5 bg-white gap-3">
                  <div>
                    <div className="text-gray-700 font-medium">
                      Building Maintenance Share
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono">
                      {activeModalInvoice.building_maintenance_total > 0 &&
                      activeModalInvoice.building_unit_count > 0
                        ? `${formatINR(activeModalInvoice.building_maintenance_total)} ÷ ${activeModalInvoice.building_unit_count} units`
                        : 'Shared building motor EB & cleaning'}
                    </div>
                    {activeModalInvoice.building_maintenance_items.length > 0 && (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {activeModalInvoice.building_maintenance_items
                          .map((item) => `${item.name} (${formatINR(item.amount)})`)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-[#0f172a] shrink-0">
                    {formatINR(activeModalInvoice.building_maintenance_share)}
                  </span>
                </div>

                <div className="flex justify-between px-3.5 py-2.5 bg-white">
                  <div>
                    <div className="text-gray-700 font-medium">Water Sub-Meter</div>
                    <div className="text-[11px] text-gray-500 font-mono">
                      M1: {activeModalInvoice.water_prev_1} →{' '}
                      {activeModalInvoice.water_curr_1}
                      {activeModalInvoice.water_curr_2 > 0 ||
                      activeModalInvoice.water_prev_2 > 0
                        ? ` | M2: ${activeModalInvoice.water_prev_2} → ${activeModalInvoice.water_curr_2}`
                        : ''}{' '}
                      ({activeModalInvoice.water_net_units}u × ₹
                      {activeModalInvoice.water_rate})
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                    {formatINR(activeModalInvoice.water_amount)}
                  </span>
                </div>

                <div className="flex justify-between px-3.5 py-2.5 bg-white gap-2">
                  <div>
                    <div className="text-gray-700 font-medium">
                      Unit Electricity (EB)
                    </div>
                    {(() => {
                      const activeBreakdown = getInvoiceBreakdown(activeModalInvoice);
                      return (
                        <div className="text-[11px] text-gray-500">
                          {activeBreakdown.ebCollectionMode}
                          {activeBreakdown.ebPaidDateLabel
                            ? ` · Paid: ${activeBreakdown.ebPaidDateLabel}`
                            : ''}
                        </div>
                      );
                    })()}
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-[#0f172a]">
                    {formatINR(activeModalInvoice.eb_amount)}
                  </span>
                </div>

                {activeModalInvoice.carried_forward_balance > 0 && (
                  <div className="flex justify-between px-3.5 py-2.5 bg-purple-50/70">
                    <div>
                      <div className="text-purple-900 font-semibold">
                        Previous Arrears / Carried Forward Balance
                      </div>
                      <div className="text-[11px] text-purple-700">
                        From prior Partially Paid &amp; Closed invoice
                      </div>
                    </div>
                    <span className="font-mono tabular-nums font-bold text-purple-900">
                      {formatINR(activeModalInvoice.carried_forward_balance)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between px-3.5 py-2.5 bg-gray-50 font-semibold">
                  <span className="text-gray-600">Total Bill Value</span>
                  <span className="font-mono tabular-nums text-[#0f172a]">
                    {formatINR(activeModalInvoice.total_bill_value)}
                  </span>
                </div>

                <div className="flex justify-between px-3.5 py-3 bg-[#3E8E41] text-white font-bold text-sm">
                  <span>Total Payable to Owner</span>
                  <span className="font-mono tabular-nums">
                    {formatINR(activeModalInvoice.total_payable_to_owner)}
                  </span>
                </div>

                {activeModalInvoice.amount_paid > 0 && (
                  <>
                    <div className="flex justify-between px-3.5 py-2 bg-emerald-50 text-[#3E8E41] font-semibold">
                      <span>Amount Paid</span>
                      <span className="font-mono tabular-nums">
                        {formatINR(activeModalInvoice.amount_paid)}
                      </span>
                    </div>
                    <div className="flex justify-between px-3.5 py-2.5 bg-white font-bold text-rose-700">
                      <span>Remaining Balance Due</span>
                      <span className="font-mono tabular-nums">
                        {formatINR(activeModalInvoice.balance_due)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Non-Editable Image Share & Print Actions */}
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    const target = activeModalInvoice;
                    setViewingInvoiceId(null);
                    openShareImageModal(target);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#3E8E41] cursor-pointer min-h-[42px]"
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>Generate &amp; Share PNG Invoice</span>
                </button>

                <button
                  type="button"
                  onClick={() => triggerPrint(activeModalInvoice.id)}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#0f172a] hover:bg-gray-50 cursor-pointer min-h-[40px]"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Invoice</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Non-Editable PNG Invoice Preview, Download & Share Modal */}
      {sharingInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/60 backdrop-blur-xs p-2 sm:p-4 print:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="png-invoice-modal-title"
        >
          <div className="w-[95vw] max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div className="min-w-0">
                <div className="text-xs font-mono font-semibold text-[#3E8E41]">
                  {sharingInvoice.id} · Non-Editable PNG Statement
                </div>
                <h3
                  id="png-invoice-modal-title"
                  className="text-base font-bold text-[#0f172a] mt-0.5 truncate"
                >
                  {sharingInvoice.tenant_name} — {formatBillingMonthLabel(sharingInvoice.billing_month)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSharingInvoiceId(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer shrink-0"
                aria-label="Close invoice image preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-3 flex justify-center">
              <div
                ref={invoiceCaptureRef}
                style={{
                  backgroundColor: '#FFFFFF',
                  color: '#000000',
                  display: 'inline-block',
                  padding: '8px',
                }}
              >
                <InvoiceImageTemplate
                  invoice={sharingInvoice}
                  ebAccountFallback={sharingUnit?.eb_rr_number || ''}
                  waterRr1Fallback={sharingUnit?.water_rr_number || ''}
                  waterRr2Fallback={sharingUnit?.water_rr_number2 || ''}
                />
              </div>
            </div>

            {shareFeedback && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-[#3E8E41]">
                <CheckCircle2 className="w-4 h-4 text-[#489E44] shrink-0" />
                <span>{shareFeedback}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isGeneratingImage}
                onClick={() => void handleShareInvoicePng()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#489E44] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#3E8E41] disabled:opacity-60 cursor-pointer min-h-[44px]"
              >
                <Share2 className="w-4 h-4" />
                <span>{isGeneratingImage ? 'Generating...' : 'Share Image (WhatsApp)'}</span>
              </button>

              <button
                type="button"
                disabled={isGeneratingImage}
                onClick={() => void handleDownloadInvoicePng()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-[#0f172a] hover:bg-gray-50 disabled:opacity-60 cursor-pointer min-h-[44px]"
              >
                <Download className="w-4 h-4 text-[#489E44]" />
                <span>Download PNG</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print-Friendly @media print Invoice Layout */}
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

          <div className="grid grid-cols-2 gap-6 my-6 text-sm">
            <div>
              <div className="text-xs uppercase text-slate-500 font-bold">Billed To</div>
              <div className="font-bold text-base mt-1">{printableInvoice.tenant_name}</div>
              <div>{printableInvoice.whatsapp_phone}</div>
              <div>Lease Type: {printableInvoice.lease_type}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase text-slate-500 font-bold">
                House &amp; Unit
              </div>
              <div className="font-bold text-base mt-1">
                {printableInvoice.property_name} — {printableInvoice.unit_name}
              </div>
              <div>
                {printableInvoice.unit_type} · {printableInvoice.floor}
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
                  {printableInvoice.lease_type} Agreement
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(printableInvoice.rent_amount)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 py-2 px-3 font-medium">
                  Monthly Cleaning Fee (Fixed)
                </td>
                <td className="border border-slate-300 py-2 px-3">
                  Agreed tenant fixed monthly cleaning fee
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(printableInvoice.tenant_cleaning_fee)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 py-2 px-3 font-medium">
                  Building Maintenance Share
                </td>
                <td className="border border-slate-300 py-2 px-3 text-xs">
                  <div>
                    {printableInvoice.building_maintenance_total > 0 &&
                    printableInvoice.building_unit_count > 0
                      ? `Equal share: ${formatINR(printableInvoice.building_maintenance_total)} ÷ ${printableInvoice.building_unit_count} units`
                      : 'Shared building expenses'}
                  </div>
                  {printableInvoice.building_maintenance_items.length > 0 && (
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      {printableInvoice.building_maintenance_items
                        .map((item) => `${item.name}: ${formatINR(item.amount)}`)
                        .join(' | ')}
                    </div>
                  )}
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(printableInvoice.building_maintenance_share)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 py-2 px-3 font-medium">
                  Water Sub-Meter
                </td>
                <td className="border border-slate-300 py-2 px-3 font-mono text-xs">
                  M1: {printableInvoice.water_prev_1}→{printableInvoice.water_curr_1}
                  {printableInvoice.water_curr_2 > 0 || printableInvoice.water_prev_2 > 0
                    ? ` | M2: ${printableInvoice.water_prev_2}→${printableInvoice.water_curr_2}`
                    : ''}{' '}
                  ({printableInvoice.water_net_units}u × ₹{printableInvoice.water_rate})
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(printableInvoice.water_amount)}
                </td>
              </tr>
              <tr>
                <td className="border border-slate-300 py-2 px-3 font-medium">
                  Unit Electricity (EB)
                </td>
                <td className="border border-slate-300 py-2 px-3">
                  {(() => {
                    const printBreakdown = getInvoiceBreakdown(printableInvoice);
                    return `${printBreakdown.ebCollectionMode}${
                      printBreakdown.ebPaidDateLabel
                        ? ` (${printBreakdown.ebPaidDateLabel})`
                        : ''
                    }`;
                  })()}
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(printableInvoice.eb_amount)}
                </td>
              </tr>
              {printableInvoice.carried_forward_balance > 0 && (
                <tr>
                  <td className="border border-slate-300 py-2 px-3 font-medium">
                    Previous Arrears / Carried Forward Balance
                  </td>
                  <td className="border border-slate-300 py-2 px-3">
                    Carried forward from prior Partially Paid &amp; Closed invoice
                  </td>
                  <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                    {formatINR(printableInvoice.carried_forward_balance)}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={2} className="border border-slate-300 py-2 px-3 text-right">
                  Total Bill Value
                </td>
                <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                  {formatINR(printableInvoice.total_bill_value)}
                </td>
              </tr>
              <tr className="bg-slate-100 font-bold text-base">
                <td colSpan={2} className="border border-slate-300 py-2.5 px-3 text-right">
                  Total Payable to Owner
                </td>
                <td className="border border-slate-300 py-2.5 px-3 text-right font-mono">
                  {formatINR(printableInvoice.total_payable_to_owner)}
                </td>
              </tr>
              {printableInvoice.amount_paid > 0 && (
                <>
                  <tr>
                    <td colSpan={2} className="border border-slate-300 py-2 px-3 text-right">
                      Amount Paid
                    </td>
                    <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                      {formatINR(printableInvoice.amount_paid)}
                    </td>
                  </tr>
                  <tr className="font-bold">
                    <td colSpan={2} className="border border-slate-300 py-2 px-3 text-right">
                      Balance Due
                    </td>
                    <td className="border border-slate-300 py-2 px-3 text-right font-mono">
                      {formatINR(printableInvoice.balance_due)}
                    </td>
                  </tr>
                </>
              )}
            </tfoot>
          </table>

          <div className="mt-6 text-xs text-slate-600 flex justify-between items-center">
            <div>Owner Contact: {settings.owner_whatsapp_phone || settings.merchant_name}</div>
            <div>
              Generated:{' '}
              {new Date(printableInvoice.generated_at).toLocaleDateString('en-IN')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
