import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Download,
  FileText,
  LogOut,
  MessageSquare,
  Pencil,
  Search,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { getAuthFetchHeaders } from '../config/authConfig';
import {
  DeductionRow,
  InvoiceRecord,
  LeaseType,
  PropertyHouse,
  TenantAgreementFile,
  TenantRecord,
  Unit,
} from '../types/estate';
import {
  calculateLeaseEndDate,
  formatBillingMonthLabel,
  formatINR,
  formatTenureReminderWhatsApp,
  getTenureRemainingInfo,
  normalizeWhatsAppDigits,
} from '../utils/billingEngine';
import { MobileShellHeader } from './MobileShellHeader';

interface TenantLifecycleViewProps {
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  invoices: InvoiceRecord[];
  ownerWhatsappPhone: string;
  selectedPropertyId: string;
  onBack: () => void;
  onChangeSelectedPropertyId: (propertyId: string) => void;
  initialOnboardUnitId?: string | null;
  initialMoveOutUnitId?: string | null;
  onClearInitialTriggers: () => void;
  onCompleteOnboarding: (payload: {
    tenant: TenantRecord;
    unitUpdate: Unit;
  }) => void;
  onUpdateTenant: (tenant: TenantRecord) => void;
  onCompleteMoveOut: (payload: {
    tenantId: string;
    unitId: string;
    move_out_date: string;
    deductions: DeductionRow[];
    final_refundable_amount: number;
  }) => void;
  authToken?: string;
  isReadOnly?: boolean;
  senderSignature?: string;
}

async function readAndUploadAgreement(
  file: File,
  authToken?: string
): Promise<TenantAgreementFile> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });

  let serverUrl: string | undefined;
  try {
    const res = await fetch('/api/agreements/upload', {
      method: 'POST',
      headers: getAuthFetchHeaders(authToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { url?: string };
      if (json.url) serverUrl = json.url;
    }
  } catch {
    // fallback to dataUrl offline
  }

  return {
    name: file.name,
    mime_type:
      file.type ||
      (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
    size_bytes: file.size,
    data_url: dataUrl,
    server_url: serverUrl,
    uploaded_at: new Date().toISOString(),
  };
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TN';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const TenantLifecycleView: React.FC<TenantLifecycleViewProps> = ({
  properties,
  units,
  tenants,
  invoices,
  ownerWhatsappPhone,
  selectedPropertyId,
  onBack,
  onChangeSelectedPropertyId,
  initialOnboardUnitId,
  initialMoveOutUnitId,
  onClearInitialTriggers,
  onCompleteOnboarding,
  onUpdateTenant,
  onCompleteMoveOut,
  authToken,
  isReadOnly = false,
  senderSignature = 'SRKP Rental Management',
}) => {
  const [tab, setTab] = useState<'active' | 'inactive'>('active');
  const [searchQuery, setSearchQuery] = useState('');

  // Onboarding Wizard State
  const [showOnboard, setShowOnboard] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [wizardPropertyId, setWizardPropertyId] = useState('');
  const [assignedUnitId, setAssignedUnitId] = useState('');
  const [fullName, setFullName] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('+91');
  const [moveInDate, setMoveInDate] = useState(new Date().toISOString().slice(0, 10));
  const [tenureMonths, setTenureMonths] = useState('11');
  const [leaseEndDate, setLeaseEndDate] = useState(
    calculateLeaseEndDate(new Date().toISOString().slice(0, 10), 11)
  );

  const [leaseType, setLeaseType] = useState<LeaseType>('Rental');
  const [monthlyRent, setMonthlyRent] = useState('25000');
  const [securityDeposit, setSecurityDeposit] = useState('100000');
  const [leaseDeposit, setLeaseDeposit] = useState('1200000');
  const [monthlyMaintCharge, setMonthlyMaintCharge] = useState('1000');

  const [waterCharge, setWaterCharge] = useState('45.00');
  const [initWater1, setInitWater1] = useState('0');
  const [initWater2, setInitWater2] = useState('0');
  const [onboardAgreement, setOnboardAgreement] = useState<TenantAgreementFile | null>(
    null
  );
  const [agreementUploading, setAgreementUploading] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);

  // Move-Out Settlement State
  const [moveOutTenantId, setMoveOutTenantId] = useState<string | null>(null);
  const [moveOutDate, setMoveOutDate] = useState(new Date().toISOString().slice(0, 10));
  const [deductions, setDeductions] = useState<DeductionRow[]>([]);
  const [deductReason, setDeductReason] = useState('');
  const [deductAmount, setDeductAmount] = useState('');

  // Edit Tenant Profile & Rates State
  const [editingTenant, setEditingTenant] = useState<TenantRecord | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editWhatsapp, setEditWhatsapp] = useState('');
  const [editTenureMonths, setEditTenureMonths] = useState('11');
  const [editLeaseEndDate, setEditLeaseEndDate] = useState('');
  const [editMaintCharge, setEditMaintCharge] = useState('0');
  const [editMonthlyRent, setEditMonthlyRent] = useState('0');
  const [editSecurityDeposit, setEditSecurityDeposit] = useState('0');
  const [editLeaseDeposit, setEditLeaseDeposit] = useState('0');
  const [editWaterCharge, setEditWaterCharge] = useState('0');
  const [editAgreement, setEditAgreement] = useState<TenantAgreementFile | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Agreement Document Preview Modal State
  const [previewTenant, setPreviewTenant] = useState<TenantRecord | null>(null);

  const allVacantUnits = useMemo(
    () => units.filter((u) => u.status === 'VACANT'),
    [units]
  );

  const wizardVacantUnits = useMemo(
    () =>
      units.filter(
        (u) => u.status === 'VACANT' && u.property_id === wizardPropertyId
      ),
    [units, wizardPropertyId]
  );

  const selectedUnitForOnboard = useMemo(
    () => units.find((u) => u.unit_id === assignedUnitId) || null,
    [units, assignedUnitId]
  );

  const openOnboardWizard = (unitId?: string) => {
    const targetUnit =
      (unitId ? units.find((u) => u.unit_id === unitId) : undefined) ||
      (selectedPropertyId !== 'ALL'
        ? allVacantUnits.find((u) => u.property_id === selectedPropertyId)
        : allVacantUnits[0]) ||
      allVacantUnits[0];

    const fallbackPropId =
      targetUnit?.property_id ||
      (selectedPropertyId !== 'ALL'
        ? selectedPropertyId
        : properties[0]?.property_id) ||
      '';

    const todayStr = new Date().toISOString().slice(0, 10);
    setWizardPropertyId(fallbackPropId);
    setAssignedUnitId(targetUnit?.unit_id || '');
    setFullName('');
    setWhatsappPhone('+91');
    setMoveInDate(todayStr);
    setTenureMonths('11');
    setLeaseEndDate(calculateLeaseEndDate(todayStr, 11));
    setLeaseType('Rental');
    setMonthlyRent('25000');
    setSecurityDeposit('100000');
    setLeaseDeposit('1200000');
    setMonthlyMaintCharge('1000');
    setWaterCharge('45.00');
    setInitWater1(String(targetUnit?.last_water_reading_1 || 0));
    setInitWater2(String(targetUnit?.last_water_reading_2 || 0));
    setOnboardAgreement(null);
    setStep(1);
    setOnboardError(null);
    setShowOnboard(true);
  };

  const openMoveOutModal = (tenantId: string) => {
    setMoveOutTenantId(tenantId);
    setMoveOutDate(new Date().toISOString().slice(0, 10));

    const tenantInvoices = invoices
      .filter((inv) => inv.tenant_id === tenantId)
      .sort((a, b) => b.billing_month.localeCompare(a.billing_month));
    const latestInvoice = tenantInvoices[0];

    const initialDeductions: DeductionRow[] = [
      { id: 'ded-1', deduction_reason: 'Painting & Deep Cleaning', amount: 4500 },
    ];

    if (
      latestInvoice &&
      latestInvoice.payment_status === 'Partially Paid & Closed' &&
      latestInvoice.balance_due > 0
    ) {
      initialDeductions.unshift({
        id: 'ded-arrears',
        deduction_reason: `Carried Forward Invoice Balance (${formatBillingMonthLabel(
          latestInvoice.billing_month
        )})`,
        amount: latestInvoice.balance_due,
      });
    }

    setDeductions(initialDeductions);
    setDeductReason('');
    setDeductAmount('');
  };

  useEffect(() => {
    if (initialOnboardUnitId) {
      openOnboardWizard(initialOnboardUnitId);
      onClearInitialTriggers();
    }
  }, [initialOnboardUnitId]);

  useEffect(() => {
    if (initialMoveOutUnitId) {
      const unit = units.find((u) => u.unit_id === initialMoveOutUnitId);
      if (unit?.current_tenant_id) {
        openMoveOutModal(unit.current_tenant_id);
      }
      onClearInitialTriggers();
    }
  }, [initialMoveOutUnitId, units]);

  const visibleProperties = useMemo(
    () =>
      selectedPropertyId === 'ALL'
        ? properties
        : properties.filter((p) => p.property_id === selectedPropertyId),
    [properties, selectedPropertyId]
  );

  const visibleTenants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tenants.filter((t) => {
      if (tab === 'active' && !t.is_active) return false;
      if (tab === 'inactive' && t.is_active) return false;
      if (selectedPropertyId !== 'ALL' && t.property_id !== selectedPropertyId) {
        return false;
      }
      if (!q) return true;
      const unit = units.find((u) => u.unit_id === t.unit_id);
      const prop = properties.find((p) => p.property_id === t.property_id);
      return (
        t.full_name.toLowerCase().includes(q) ||
        t.whatsapp_phone.toLowerCase().includes(q) ||
        (unit?.unit_name.toLowerCase().includes(q) ?? false) ||
        (prop?.property_name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tenants, tab, searchQuery, selectedPropertyId, units, properties]);

  const moveOutTenant = useMemo(
    () => (moveOutTenantId ? tenants.find((t) => t.id === moveOutTenantId) || null : null),
    [tenants, moveOutTenantId]
  );

  const moveOutUnit = useMemo(
    () =>
      moveOutTenant
        ? units.find((u) => u.unit_id === moveOutTenant.unit_id) || null
        : null,
    [units, moveOutTenant]
  );

  const moveOutProperty = useMemo(
    () =>
      moveOutTenant
        ? properties.find((p) => p.property_id === moveOutTenant.property_id) || null
        : null,
    [properties, moveOutTenant]
  );

  const heldDeposit = moveOutTenant
    ? moveOutTenant.lease_type === 'Lease'
      ? moveOutTenant.lease_deposit
      : moveOutTenant.security_deposit
    : 0;

  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const finalRefundableAmount = heldDeposit - totalDeductions;

  const handleWizardPropertyChange = (nextPropId: string) => {
    setWizardPropertyId(nextPropId);
    const firstVacant = units.find(
      (u) => u.property_id === nextPropId && u.status === 'VACANT'
    );
    setAssignedUnitId(firstVacant?.unit_id || '');
    setInitWater1(String(firstVacant?.last_water_reading_1 || 0));
    setInitWater2(String(firstVacant?.last_water_reading_2 || 0));
  };

  const handleAgreementSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    mode: 'onboard' | 'edit'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      const msg = 'Agreement file must be under 6 MB (PDF, JPG, or PNG).';
      if (mode === 'onboard') setOnboardError(msg);
      else setEditError(msg);
      e.target.value = '';
      return;
    }

    setAgreementUploading(true);
    try {
      const parsed = await readAndUploadAgreement(file, authToken);
      if (mode === 'onboard') setOnboardAgreement(parsed);
      else setEditAgreement(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to attach agreement.';
      if (mode === 'onboard') setOnboardError(msg);
      else setEditError(msg);
    } finally {
      setAgreementUploading(false);
      e.target.value = '';
    }
  };

  const handleNextStep = () => {
    setOnboardError(null);
    if (step === 1) {
      if (!wizardPropertyId) {
        setOnboardError('Select a House / Property.');
        return;
      }
      if (!assignedUnitId) {
        setOnboardError('Select a vacant unit within the chosen House.');
        return;
      }
      if (!fullName.trim()) {
        setOnboardError('Tenant full name is required.');
        return;
      }
      if (whatsappPhone.replace(/\D/g, '').length < 10) {
        setOnboardError('Enter a valid WhatsApp phone number with country code.');
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      const maintVal = Number(monthlyMaintCharge);
      const tenureVal = Number(tenureMonths);
      if (!Number.isFinite(tenureVal) || tenureVal < 1) {
        setOnboardError('Enter a valid Tenure duration in months (at least 1).');
        return;
      }
      if (!Number.isFinite(maintVal) || maintVal < 0) {
        setOnboardError('Enter a valid Monthly Maintenance Charge (0 or more).');
        return;
      }
      if (leaseType === 'Lease') {
        if (!Number(leaseDeposit) || Number(leaseDeposit) <= 0) {
          setOnboardError('Enter a valid Lease Deposit amount.');
          return;
        }
      } else {
        if (!Number(monthlyRent) || Number(monthlyRent) <= 0) {
          setOnboardError('Enter a valid Monthly Rent amount.');
          return;
        }
      }
      setStep(3);
    }
  };

  const handleCompleteOnboarding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUnitForOnboard) return;

    const rate = Number(waterCharge);
    if (!Number.isFinite(rate) || rate < 0) {
      setOnboardError('Enter a valid decimal water charge rate.');
      return;
    }

    const r1 = Number(initWater1) || 0;
    const r2 = selectedUnitForOnboard.water_rr_number2 ? Number(initWater2) || 0 : 0;

    const finalMonthlyRent = leaseType === 'Lease' ? 0 : Number(monthlyRent) || 0;
    const finalSecurityDeposit = leaseType === 'Lease' ? 0 : Number(securityDeposit) || 0;
    const finalLeaseDeposit = leaseType === 'Lease' ? Number(leaseDeposit) || 0 : 0;
    const finalMaintCharge = Math.max(0, Number(monthlyMaintCharge) || 0);
    const finalTenure = Math.max(1, Math.round(Number(tenureMonths) || 11));
    const finalEndDate =
      leaseEndDate || calculateLeaseEndDate(moveInDate, finalTenure);

    const newTenant: TenantRecord = {
      id: `TEN-${Date.now().toString().slice(-5)}`,
      property_id: selectedUnitForOnboard.property_id,
      unit_id: selectedUnitForOnboard.unit_id,
      full_name: fullName.trim(),
      whatsapp_phone: whatsappPhone.trim(),
      move_in_date: moveInDate,
      tenure_months: finalTenure,
      lease_end_date: finalEndDate,
      move_out_date: null,
      lease_type: leaseType,
      monthly_rent: finalMonthlyRent,
      security_deposit: finalSecurityDeposit,
      lease_deposit: finalLeaseDeposit,
      monthly_maintenance_charge: finalMaintCharge,
      water_charge: rate,
      initial_water_reading_1: r1,
      initial_water_reading_2: r2,
      is_active: true,
      agreement_file: onboardAgreement,
      agreement_url: onboardAgreement?.server_url || '',
    };

    const unitUpdate: Unit = {
      ...selectedUnitForOnboard,
      status: 'OCCUPIED',
      current_tenant_id: newTenant.id,
      last_water_reading_1: r1,
      last_water_reading_2: r2,
    };

    onCompleteOnboarding({
      tenant: newTenant,
      unitUpdate,
    });
    setShowOnboard(false);
  };

  const handleAddDeduction = () => {
    const amt = Number(deductAmount);
    if (!deductReason.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setDeductions((prev) => [
      ...prev,
      { id: `ded-${Date.now()}`, deduction_reason: deductReason.trim(), amount: amt },
    ]);
    setDeductReason('');
    setDeductAmount('');
  };

  const openEditTenantModal = (tenant: TenantRecord) => {
    setEditingTenant(tenant);
    setEditFullName(tenant.full_name);
    setEditWhatsapp(tenant.whatsapp_phone);
    setEditTenureMonths(String(tenant.tenure_months || 11));
    setEditLeaseEndDate(
      tenant.lease_end_date ||
        calculateLeaseEndDate(tenant.move_in_date, tenant.tenure_months || 11)
    );
    setEditMaintCharge(String(tenant.monthly_maintenance_charge));
    setEditMonthlyRent(String(tenant.monthly_rent));
    setEditSecurityDeposit(String(tenant.security_deposit));
    setEditLeaseDeposit(String(tenant.lease_deposit));
    setEditWaterCharge(String(tenant.water_charge));
    setEditAgreement(tenant.agreement_file || null);
    setEditError(null);
  };

  const handleSaveTenantEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;
    setEditError(null);

    if (!editFullName.trim()) {
      setEditError('Tenant full name is required.');
      return;
    }
    if (editWhatsapp.replace(/\D/g, '').length < 10) {
      setEditError('Enter a valid WhatsApp phone number with country code.');
      return;
    }

    const maint = Number(editMaintCharge);
    const rate = Number(editWaterCharge);
    const tenure = Math.max(1, Math.round(Number(editTenureMonths) || 11));
    if (!Number.isFinite(maint) || maint < 0) {
      setEditError('Enter a valid Monthly Cleaning Fee (0 or more).');
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      setEditError('Enter a valid Water Charge rate (0 or more).');
      return;
    }

    const updated: TenantRecord = {
      ...editingTenant,
      full_name: editFullName.trim(),
      whatsapp_phone: editWhatsapp.trim(),
      tenure_months: tenure,
      lease_end_date:
        editLeaseEndDate ||
        calculateLeaseEndDate(editingTenant.move_in_date, tenure),
      monthly_maintenance_charge: Math.round(maint),
      water_charge: rate,
      monthly_rent:
        editingTenant.lease_type === 'Lease'
          ? 0
          : Math.max(0, Number(editMonthlyRent) || 0),
      security_deposit:
        editingTenant.lease_type === 'Lease'
          ? 0
          : Math.max(0, Number(editSecurityDeposit) || 0),
      lease_deposit:
        editingTenant.lease_type === 'Lease'
          ? Math.max(0, Number(editLeaseDeposit) || 0)
          : 0,
      agreement_file: editAgreement,
      agreement_url: editAgreement?.server_url || editingTenant.agreement_url || '',
    };

    onUpdateTenant(updated);
    setEditingTenant(null);
  };

  const handleConfirmMoveOut = () => {
    if (!moveOutTenant) return;
    onCompleteMoveOut({
      tenantId: moveOutTenant.id,
      unitId: moveOutTenant.unit_id,
      move_out_date: moveOutDate,
      deductions,
      final_refundable_amount: finalRefundableAmount,
    });
    setMoveOutTenantId(null);
  };

  const previewFileSrc =
    previewTenant?.agreement_file?.data_url ||
    previewTenant?.agreement_file?.server_url ||
    previewTenant?.agreement_url ||
    '';

  const previewIsPdf =
    previewTenant?.agreement_file?.mime_type === 'application/pdf' ||
    previewTenant?.agreement_file?.name?.toLowerCase().endsWith('.pdf') ||
    previewFileSrc.startsWith('data:application/pdf') ||
    previewFileSrc.toLowerCase().endsWith('.pdf');

  return (
    <div className="min-h-full">
      <MobileShellHeader
        title="Tenants"
        subtitle={`${allVacantUnits.length} vacant unit${allVacantUnits.length === 1 ? '' : 's'} ready`}
        onBack={onBack}
        rightSlot={
          !isReadOnly ? (
            <button
              type="button"
              onClick={() => openOnboardWizard()}
              disabled={allVacantUnits.length === 0}
              className="inline-flex items-center gap-1 rounded-xl bg-white text-[#3E8E41] px-3 py-1.5 text-xs font-bold shadow-2xs hover:bg-emerald-50 disabled:opacity-50 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Onboard</span>
            </button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-white/15">
          <button
            type="button"
            onClick={() => setTab('active')}
            className={`py-2 px-3 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
              tab === 'active'
                ? 'bg-white text-[#3E8E41] shadow-xs'
                : 'text-white/90 hover:bg-white/10'
            }`}
          >
            Active ({tenants.filter((t) => t.is_active).length})
          </button>
          <button
            type="button"
            onClick={() => setTab('inactive')}
            className={`py-2 px-3 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
              tab === 'inactive'
                ? 'bg-white text-[#3E8E41] shadow-xs'
                : 'text-white/90 hover:bg-white/10'
            }`}
          >
            Moved Out ({tenants.filter((t) => !t.is_active).length})
          </button>
        </div>
      </MobileShellHeader>

      {/* Curved White Lower Sheet */}
      <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[calc(100vh-150px)] space-y-4">
        {/* House Filter + Search */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <select
              aria-label="Filter Tenants by House"
              value={selectedPropertyId}
              onChange={(e) => onChangeSelectedPropertyId(e.target.value)}
              className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[40px]"
            >
              <option value="ALL">All Houses ({properties.length})</option>
              {properties.map((p) => (
                <option key={p.property_id} value={p.property_id}>
                  {p.property_name}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tenant, phone, unit..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 py-2 text-xs text-[#0f172a] min-h-[40px]"
            />
          </div>
        </div>

        {/* Tenants Grouped by House */}
        {visibleTenants.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-8 text-center text-xs text-gray-500">
            No {tab === 'active' ? 'active' : 'settled'} tenant records found.
          </div>
        ) : (
          <div className="space-y-5">
            {visibleProperties.map((property) => {
              const propTenants = visibleTenants.filter(
                (t) => t.property_id === property.property_id
              );
              if (propTenants.length === 0) return null;

              return (
                <section key={property.property_id} className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <Building2 className="w-4 h-4 text-[#489E44]" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                      {property.property_name} ({propTenants.length})
                    </h2>
                  </div>

                  <div className="space-y-3">
                    {propTenants.map((tenant) => {
                      const unit = units.find((u) => u.unit_id === tenant.unit_id);
                      const depositHeld =
                        tenant.lease_type === 'Lease'
                          ? tenant.lease_deposit
                          : tenant.security_deposit;

                      const tenureInfo = getTenureRemainingInfo(
                        tenant.lease_end_date ||
                          calculateLeaseEndDate(
                            tenant.move_in_date,
                            tenant.tenure_months || 11
                          )
                      );
                      const hasAgreement = Boolean(
                        tenant.agreement_file?.data_url ||
                          tenant.agreement_file?.server_url ||
                          tenant.agreement_url
                      );

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

                      const tenantWaReminderHref = `https://wa.me/${normalizeWhatsAppDigits(
                        tenant.whatsapp_phone
                      )}?text=${encodeURIComponent(
                        formatTenureReminderWhatsApp({
                          recipient: 'tenant',
                          tenant,
                          propertyName: property.property_name,
                          unitName: unit?.unit_name || tenant.unit_id,
                          remainingLabel: tenureInfo.label,
                          senderSignature,
                        })
                      )}`;

                      const ownerWaReminderHref = `https://wa.me/${normalizeWhatsAppDigits(
                        ownerWhatsappPhone || tenant.whatsapp_phone
                      )}?text=${encodeURIComponent(
                        formatTenureReminderWhatsApp({
                          recipient: 'owner',
                          tenant,
                          propertyName: property.property_name,
                          unitName: unit?.unit_name || tenant.unit_id,
                          remainingLabel: tenureInfo.label,
                          senderSignature,
                        })
                      )}`;

                      return (
                        <article
                          key={tenant.id}
                          className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-xs space-y-3"
                        >
                          {/* Corner Ribbon */}
                          <div
                            className={`absolute top-3 -right-8 w-28 rotate-45 text-center text-[9px] font-extrabold tracking-wider py-0.5 text-white shadow-2xs pointer-events-none ${ribbonBg}`}
                          >
                            {ribbonLabel}
                          </div>

                          <div className="flex items-center gap-3 pr-8">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[#3E8E41] font-bold text-xs">
                              {getInitials(tenant.full_name)}
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-sm font-bold text-[#0f172a] truncate">
                                {tenant.full_name}
                              </h3>
                              <div className="text-[11px] text-gray-500 truncate">
                                {unit
                                  ? `${unit.unit_name} · ${unit.unit_type} (${unit.floor})`
                                  : tenant.unit_id}
                              </div>
                            </div>
                          </div>

                          {/* Tenure Expiring Soon Alert */}
                          {tenant.is_active && tenureInfo.isExpiringSoon && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                              <div className="flex items-start gap-2 text-xs text-amber-950">
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                  <div className="font-bold">
                                    Tenure Expiring · {tenureInfo.label}
                                  </div>
                                  <div className="text-[11px] text-amber-900">
                                    Ends {tenant.lease_end_date} ({tenant.tenure_months}m)
                                  </div>
                                </div>
                              </div>
                              {!isReadOnly && (
                                <div className="flex gap-2">
                                  <a
                                    href={tenantWaReminderHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-[#489E44] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#3E8E41]"
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    <span>Remind Tenant</span>
                                  </a>
                                  <a
                                    href={ownerWaReminderHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-[#0f172a] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
                                  >
                                    <MessageSquare className="w-3 h-3 text-[#FACC15]" />
                                    <span>Alert Owner</span>
                                  </a>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="rounded-xl bg-gray-50 p-3 space-y-1.5 text-xs text-gray-600">
                            <div className="flex justify-between gap-2">
                              <span>WhatsApp</span>
                              <span className="font-mono font-semibold text-[#0f172a]">
                                {tenant.whatsapp_phone}
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span>Move-In → End</span>
                              <span className="font-mono text-[#0f172a]">
                                {tenant.move_in_date} → {tenant.lease_end_date}
                              </span>
                            </div>
                            {tenant.lease_type === 'Rental' ? (
                              <div className="flex justify-between gap-2">
                                <span>Rent / Deposit</span>
                                <span className="font-mono font-bold text-[#3E8E41]">
                                  {formatINR(tenant.monthly_rent)} / {formatINR(depositHeld)}
                                </span>
                              </div>
                            ) : (
                              <div className="flex justify-between gap-2">
                                <span>Lease Deposit (₹0 Rent)</span>
                                <span className="font-mono font-bold text-[#3E8E41]">
                                  {formatINR(depositHeld)}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between gap-2">
                              <span>Cleaning Fee · Water</span>
                              <span className="font-mono font-semibold text-[#0f172a]">
                                {formatINR(tenant.monthly_maintenance_charge)} · ₹{tenant.water_charge}/u
                              </span>
                            </div>
                            {!tenant.is_active &&
                              tenant.final_refundable_amount !== undefined && (
                                <div className="flex justify-between gap-2 pt-1 border-t border-gray-200 font-bold text-[#3E8E41]">
                                  <span>Final Refundable</span>
                                  <span className="font-mono">
                                    {formatINR(tenant.final_refundable_amount)}
                                  </span>
                                </div>
                              )}
                          </div>

                          <div className="space-y-2">
                            {hasAgreement ? (
                              <button
                                type="button"
                                onClick={() => setPreviewTenant(tenant)}
                                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-[#3E8E41] hover:bg-emerald-100 cursor-pointer"
                              >
                                <FileText className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">
                                  View Agreement ({tenant.agreement_file?.name || 'Document'})
                                </span>
                              </button>
                            ) : (
                              tenant.is_active &&
                              !isReadOnly && (
                                <button
                                  type="button"
                                  onClick={() => openEditTenantModal(tenant)}
                                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-500 hover:text-[#0f172a] cursor-pointer"
                                >
                                  <Upload className="w-3 h-3" />
                                  <span>Attach Lease Agreement</span>
                                </button>
                              )
                            )}

                            {tenant.is_active && !isReadOnly && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditTenantModal(tenant)}
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] hover:bg-gray-50 cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-[#489E44]" />
                                  <span>Edit Profile</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openMoveOutModal(tenant.id)}
                                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#0f172a] px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                                >
                                  <LogOut className="w-3.5 h-3.5" />
                                  <span>Move-Out</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* 3-Step Onboarding Wizard Modal */}
      {showOnboard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div>
                <div className="text-xs font-bold text-[#489E44]">
                  Step {step} of 3 · Onboarding Wizard
                </div>
                <h3 className="text-base font-bold text-[#0f172a] mt-0.5">
                  {step === 1
                    ? 'House, Unit & Tenant Info'
                    : step === 2
                      ? 'Lease Terms & Cleaning Fee'
                      : 'Water Meters & Agreement'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowOnboard(false)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"
                aria-label="Close onboarding wizard"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className={`h-1.5 rounded-full ${
                    n <= step ? 'bg-[#489E44]' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>

            <form onSubmit={handleCompleteOnboarding} className="mt-4 space-y-3.5">
              {step === 1 && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      1. Select House / Property *
                    </label>
                    <select
                      value={wizardPropertyId}
                      onChange={(e) => handleWizardPropertyChange(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-[#0f172a] min-h-[42px]"
                    >
                      {properties.map((p) => (
                        <option key={p.property_id} value={p.property_id}>
                          {p.property_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      2. Select Vacant Unit *
                    </label>
                    <select
                      value={assignedUnitId}
                      onChange={(e) => {
                        const u = units.find((item) => item.unit_id === e.target.value);
                        setAssignedUnitId(e.target.value);
                        if (u) {
                          setInitWater1(String(u.last_water_reading_1 || 0));
                          setInitWater2(String(u.last_water_reading_2 || 0));
                        }
                      }}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-[#0f172a] min-h-[42px]"
                    >
                      {wizardVacantUnits.length === 0 ? (
                        <option value="">No vacant units in this house</option>
                      ) : (
                        wizardVacantUnits.map((u) => (
                          <option key={u.unit_id} value={u.unit_id}>
                            {u.unit_name} · {u.unit_type} ({u.floor})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Tenant Full Name *
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g., Vikramaditya Rao"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        WhatsApp Phone *
                      </label>
                      <input
                        type="tel"
                        value={whatsappPhone}
                        onChange={(e) => setWhatsappPhone(e.target.value)}
                        placeholder="+919845000000"
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Move-in Date *
                      </label>
                      <input
                        type="date"
                        value={moveInDate}
                        onChange={(e) => {
                          const nextDate = e.target.value;
                          setMoveInDate(nextDate);
                          setLeaseEndDate(
                            calculateLeaseEndDate(nextDate, Number(tenureMonths) || 11)
                          );
                        }}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                      />
                    </div>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Select Lease Type *
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-gray-100">
                      {(['Rental', 'Lease'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            setLeaseType(type);
                            if (type === 'Lease') {
                              setMonthlyRent('0');
                              setSecurityDeposit('0');
                            } else {
                              setLeaseDeposit('0');
                              if (monthlyRent === '0') setMonthlyRent('25000');
                              if (securityDeposit === '0') setSecurityDeposit('100000');
                            }
                          }}
                          className={`py-2 px-3 rounded-lg text-xs font-bold cursor-pointer ${
                            leaseType === type
                              ? 'bg-white text-[#0f172a] shadow-2xs'
                              : 'text-gray-600'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Tenure (Months)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={tenureMonths}
                        onChange={(e) => {
                          setTenureMonths(e.target.value);
                          const m = Number(e.target.value);
                          if (m >= 1) {
                            setLeaseEndDate(calculateLeaseEndDate(moveInDate, m));
                          }
                        }}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Lease End Date
                      </label>
                      <input
                        type="date"
                        value={leaseEndDate}
                        onChange={(e) => setLeaseEndDate(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-mono text-[#0f172a]"
                      />
                    </div>
                  </div>

                  {leaseType === 'Rental' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Monthly Rent (INR) *
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={monthlyRent}
                          onChange={(e) => setMonthlyRent(e.target.value)}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Security Deposit *
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={securityDeposit}
                          onChange={(e) => setSecurityDeposit(e.target.value)}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Lease Deposit (INR) *
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={leaseDeposit}
                        onChange={(e) => setLeaseDeposit(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Monthly Cleaning Fee (Fixed Tenant Maint, INR) *
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={monthlyMaintCharge}
                      onChange={(e) => setMonthlyMaintCharge(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                    />
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Water Charge Rate (INR per unit) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={waterCharge}
                      onChange={(e) => setWaterCharge(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Init Water #1 ({selectedUnitForOnboard?.water_rr_number})
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={initWater1}
                        onChange={(e) => setInitWater1(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-semibold text-[#0f172a]"
                      />
                    </div>

                    {selectedUnitForOnboard?.water_rr_number2 && (
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Init Water #2 ({selectedUnitForOnboard.water_rr_number2})
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={initWater2}
                          onChange={(e) => setInitWater2(e.target.value)}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-semibold text-[#0f172a]"
                        />
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 space-y-2">
                    <label className="block text-xs font-bold text-[#0f172a]">
                      Lease Agreement (PDF, JPG, PNG)
                    </label>
                    <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-xs font-semibold text-[#489E44] hover:bg-emerald-50 cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span>
                        {agreementUploading
                          ? 'Uploading...'
                          : onboardAgreement
                            ? `Attached: ${onboardAgreement.name}`
                            : 'Choose Agreement File'}
                      </span>
                      <input
                        type="file"
                        accept=".pdf,application/pdf,image/jpeg,image/png"
                        className="hidden"
                        onChange={(e) => handleAgreementSelect(e, 'onboard')}
                        disabled={agreementUploading}
                      />
                    </label>
                  </div>
                </>
              )}

              {onboardError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {onboardError}
                </div>
              )}

              <div className="pt-2 flex items-center justify-between">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                    className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back</span>
                  </button>
                ) : (
                  <div />
                )}

                {step < 3 ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#489E44] px-5 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer"
                  >
                    <span>Continue</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-xl bg-[#489E44] px-5 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>Complete Onboarding</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move-Out Deposit Deduction Settlement Modal */}
      {moveOutTenant && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div>
                <div className="text-xs font-bold text-amber-600">
                  Move-Out Settlement
                </div>
                <h3 className="text-base font-bold text-[#0f172a] mt-0.5">
                  {moveOutTenant.full_name} · {moveOutProperty?.property_name}{' '}
                  {moveOutUnit ? `(${moveOutUnit.unit_name})` : ''}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMoveOutTenantId(null)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"
                aria-label="Close move-out settlement"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-gray-50 p-3">
                <div className="text-[11px] text-gray-500">
                  Held {moveOutTenant.lease_type === 'Lease' ? 'Lease' : 'Security'} Deposit
                </div>
                <div className="text-lg font-bold text-[#0f172a] font-mono">
                  {formatINR(heldDeposit)}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Move-Out Date
                </label>
                <input
                  type="date"
                  value={moveOutDate}
                  onChange={(e) => setMoveOutDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-[#0f172a]"
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="text-xs font-bold text-[#0f172a]">
                Itemized Deductions
              </div>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
                {deductions.length === 0 ? (
                  <div className="p-3 text-center text-xs text-gray-400">
                    No deductions added.
                  </div>
                ) : (
                  deductions.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between px-3 py-2 text-xs bg-white"
                    >
                      <span className="font-medium text-[#0f172a]">
                        {row.deduction_reason}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-rose-600">
                          -{formatINR(row.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setDeductions((prev) => prev.filter((d) => d.id !== row.id))
                          }
                          className="text-gray-400 hover:text-rose-600 cursor-pointer"
                          aria-label="Remove deduction"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={deductReason}
                  onChange={(e) => setDeductReason(e.target.value)}
                  placeholder="Reason"
                  className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs text-[#0f172a]"
                />
                <input
                  type="number"
                  min={0}
                  value={deductAmount}
                  onChange={(e) => setDeductAmount(e.target.value)}
                  placeholder="INR"
                  className="w-20 rounded-xl border border-gray-200 px-2.5 py-2 text-xs font-mono text-[#0f172a]"
                />
                <button
                  type="button"
                  onClick={handleAddDeduction}
                  className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-[#0f172a] hover:bg-gray-200 cursor-pointer"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-emerald-50 p-3.5 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-gray-600">
                  Final Refundable
                </div>
                <div className="text-[11px] text-gray-500 font-mono">
                  {formatINR(heldDeposit)} − {formatINR(totalDeductions)}
                </div>
              </div>
              <div className="text-xl font-bold text-[#3E8E41] font-mono">
                {formatINR(finalRefundableAmount)}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveOutTenantId(null)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmMoveOut}
                className="rounded-xl bg-[#489E44] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer"
              >
                Confirm &amp; Mark VACANT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tenant Profile, Tenure, Agreement & Monthly Rates Modal */}
      {editingTenant && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div>
                <div className="text-xs font-bold text-[#489E44]">
                  Edit Profile &amp; Agreed Rates
                </div>
                <h3 className="text-base font-bold text-[#0f172a] mt-0.5">
                  {editingTenant.full_name} ({editingTenant.lease_type})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingTenant(null)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"
                aria-label="Close edit tenant modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTenantEdit} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-[#0f172a]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    WhatsApp *
                  </label>
                  <input
                    type="tel"
                    value={editWhatsapp}
                    onChange={(e) => setEditWhatsapp(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-[#0f172a]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Tenure (Months)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={editTenureMonths}
                    onChange={(e) => {
                      setEditTenureMonths(e.target.value);
                      const m = Number(e.target.value);
                      if (m >= 1) {
                        setEditLeaseEndDate(
                          calculateLeaseEndDate(editingTenant.move_in_date, m)
                        );
                      }
                    }}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Lease End Date
                  </label>
                  <input
                    type="date"
                    value={editLeaseEndDate}
                    onChange={(e) => setEditLeaseEndDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-mono text-[#0f172a]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0f172a] mb-1">
                  Monthly Cleaning Fee (Fixed, INR) *
                </label>
                <input
                  type="number"
                  min={0}
                  value={editMaintCharge}
                  onChange={(e) => setEditMaintCharge(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                />
              </div>

              {editingTenant.lease_type === 'Rental' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Monthly Rent (INR)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={editMonthlyRent}
                      onChange={(e) => setEditMonthlyRent(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Security Deposit
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={editSecurityDeposit}
                      onChange={(e) => setEditSecurityDeposit(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Lease Deposit (INR)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editLeaseDeposit}
                    onChange={(e) => setEditLeaseDeposit(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Water Charge Rate (INR per unit)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={editWaterCharge}
                  onChange={(e) => setEditWaterCharge(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                <label className="block text-xs font-bold text-[#0f172a]">
                  Lease Agreement (PDF, JPG, PNG)
                </label>
                <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2.5 text-xs font-semibold text-[#489E44] hover:bg-emerald-50 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>
                    {agreementUploading
                      ? 'Uploading...'
                      : editAgreement
                        ? `Replace: ${editAgreement.name}`
                        : 'Upload Agreement'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => handleAgreementSelect(e, 'edit')}
                    disabled={agreementUploading}
                  />
                </label>
                {editAgreement && (
                  <div className="flex items-center justify-between text-[11px] text-[#3E8E41] font-semibold">
                    <span>{editAgreement.name}</span>
                    <button
                      type="button"
                      onClick={() => setEditAgreement(null)}
                      className="text-rose-600 hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {editError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingTenant(null)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-xl bg-[#489E44] px-5 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lease Agreement Document Preview Modal */}
      {previewTenant && previewFileSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/65 backdrop-blur-xs p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div>
                <div className="text-xs font-bold text-[#489E44]">
                  Lease / Rental Agreement Viewer
                </div>
                <h3 className="text-base font-bold text-[#0f172a] mt-0.5">
                  {previewTenant.full_name} —{' '}
                  {previewTenant.agreement_file?.name || 'Lease Agreement'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewFileSrc}
                  download={previewTenant.agreement_file?.name || 'lease-agreement'}
                  className="inline-flex items-center gap-1 rounded-xl bg-[#489E44] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewTenant(null)}
                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"
                  aria-label="Close agreement viewer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {previewIsPdf ? (
              <iframe
                src={previewFileSrc}
                title={`Agreement for ${previewTenant.full_name}`}
                className="w-full h-[65vh] rounded-xl border border-gray-200 bg-gray-50"
              />
            ) : (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex items-center justify-center">
                <img
                  src={previewFileSrc}
                  alt={`Agreement for ${previewTenant.full_name}`}
                  className="max-h-[65vh] rounded-lg object-contain"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
