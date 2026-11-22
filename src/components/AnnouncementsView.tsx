import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckSquare,
  Copy,
  Eye,
  EyeOff,
  Megaphone,
  MessageSquare,
  RotateCcw,
  Square,
  Users,
} from 'lucide-react';
import {
  InvoiceRecord,
  PropertyHouse,
  TenantRecord,
  Unit,
  UtilityReading,
} from '../types/estate';
import {
  calculateLeaseEndDate,
  formatBillingMonthLabel,
  getTenureRemainingInfo,
  normalizeWhatsAppDigits,
} from '../utils/billingEngine';
import { MobileShellHeader } from './MobileShellHeader';

interface AnnouncementsViewProps {
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  utilityReadings: UtilityReading[];
  invoices: InvoiceRecord[];
  billingMonth: string;
  selectedPropertyId: string;
  onChangeSelectedPropertyId: (propertyId: string) => void;
  onBack: () => void;
}

type AudienceFilter = 'ALL_ACTIVE' | 'EXPIRING_SOON' | 'HOUSE';
type TemplateId = 'rent_reminder' | 'water_tank' | 'maintenance_notice' | 'custom';

const RENT_REMINDER_TEMPLATE =
  'Hi {tenant_name}, this is a friendly reminder regarding your monthly rent & utility billing for {house_name} ({unit_name}) — Rent: ₹{rent_amount}, Utilities: ₹{utility_amount}, Total Due: ₹{total_due}. Please share payment confirmation once completed. Thank you — SRKP Rental Management';

const WATER_TANK_TEMPLATE =
  'Notice: Overhead Tank & Sump Cleaning\n\nHi {tenant_name},\nScheduled sump & overhead tank cleaning for {house_name} ({unit_name}) will take place this weekend between 10:00 AM and 1:00 PM. Kindly store sufficient water in advance.\n\nThank you — SRKP Rental Management';

const MAINTENANCE_UPDATE_TEMPLATE =
  'Building Maintenance Update\n\nHi {tenant_name},\nCommon area maintenance and meter reading inspection at {house_name} ({unit_name}) is scheduled shortly. Thank you for your cooperation.\n\nRegards — SRKP Rental Management';

const TEMPLATE_VARIABLES = [
  '{tenant_name}',
  '{house_name}',
  '{unit_name}',
  '{rent_amount}',
  '{utility_amount}',
  '{total_due}',
] as const;

export const AnnouncementsView: React.FC<AnnouncementsViewProps> = ({
  properties,
  units,
  tenants,
  utilityReadings,
  invoices,
  billingMonth,
  selectedPropertyId,
  onChangeSelectedPropertyId,
  onBack,
}) => {
  const [audience, setAudience] = useState<AudienceFilter>('ALL_ACTIVE');
  const [templateId, setTemplateId] = useState<TemplateId>('rent_reminder');
  const [customBody, setCustomBody] = useState(RENT_REMINDER_TEMPLATE);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const targetTenants = useMemo(() => {
    return tenants.filter((t) => {
      if (!t.is_active) return false;
      if (audience === 'HOUSE' && selectedPropertyId !== 'ALL') {
        if (t.property_id !== selectedPropertyId) return false;
      }
      if (audience === 'EXPIRING_SOON') {
        const endDate =
          t.lease_end_date ||
          calculateLeaseEndDate(t.move_in_date, t.tenure_months || 11);
        if (!getTenureRemainingInfo(endDate).isExpiringSoon) return false;
      }
      return true;
    });
  }, [tenants, audience, selectedPropertyId]);

  // Default all filtered tenants to selected whenever the audience/house filter changes
  useEffect(() => {
    setSelectedIds(new Set(targetTenants.map((t) => t.id)));
  }, [audience, selectedPropertyId, tenants.length]);

  const applyTemplate = (id: TemplateId) => {
    setTemplateId(id);
    if (id === 'rent_reminder') {
      setCustomBody(RENT_REMINDER_TEMPLATE);
    } else if (id === 'water_tank') {
      setCustomBody(WATER_TANK_TEMPLATE);
    } else if (id === 'maintenance_notice') {
      setCustomBody(MAINTENANCE_UPDATE_TEMPLATE);
    }
  };

  const handleInsertVariable = (variableToken: string) => {
    const el = textareaRef.current;
    setTemplateId('custom');
    if (!el) {
      setCustomBody((prev) =>
        prev.endsWith(' ') || prev.length === 0
          ? `${prev}${variableToken}`
          : `${prev} ${variableToken}`
      );
      return;
    }

    const start = el.selectionStart ?? customBody.length;
    const end = el.selectionEnd ?? customBody.length;
    const nextText =
      customBody.slice(0, start) + variableToken + customBody.slice(end);
    setCustomBody(nextText);

    window.requestAnimationFrame(() => {
      el.focus();
      const cursor = start + variableToken.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const getTenantFinancials = (tenant: TenantRecord) => {
    const invoice = invoices.find(
      (inv) =>
        inv.tenant_id === tenant.id && inv.billing_month === billingMonth
    );
    const reading = utilityReadings.find(
      (r) => r.unit_id === tenant.unit_id && r.billing_month === billingMonth
    );

    const rentAmount = invoice
      ? invoice.rent_amount
      : tenant.lease_type === 'Lease'
        ? 0
        : tenant.monthly_rent || 0;

    const utilityAmount = reading
      ? (reading.eb_bill_amount || 0) + (reading.water_bill_amount || 0)
      : invoice
        ? (invoice.eb_amount || 0) + (invoice.water_amount || 0)
        : 0;

    const totalDue = invoice
      ? invoice.balance_due > 0 || invoice.is_locked
        ? invoice.balance_due
        : invoice.total_payable_to_owner
      : rentAmount + utilityAmount + (tenant.monthly_maintenance_charge || 0);

    return { rentAmount, utilityAmount, totalDue };
  };

  const interpolateMessage = (template: string, tenant: TenantRecord) => {
    const prop = properties.find((p) => p.property_id === tenant.property_id);
    const unit = units.find((u) => u.unit_id === tenant.unit_id);
    const { rentAmount, utilityAmount, totalDue } = getTenantFinancials(tenant);

    const replacements: Record<string, string> = {
      '{tenant_name}': tenant.full_name || 'N/A',
      '{house_name}': prop?.property_name || 'N/A',
      '{unit_name}': unit?.unit_name || 'N/A',
      '{rent_amount}': Math.round(rentAmount).toLocaleString('en-IN'),
      '{utility_amount}': Math.round(utilityAmount).toLocaleString('en-IN'),
      '{total_due}': Math.round(totalDue).toLocaleString('en-IN'),
    };

    return template.replace(
      /\{(tenant_name|house_name|unit_name|rent_amount|utility_amount|total_due)\}/g,
      (match) => replacements[match] ?? match
    );
  };

  const queuedTenants = useMemo(
    () =>
      targetTenants.filter(
        (t) => selectedIds.has(t.id) && !sentIds.has(t.id)
      ),
    [targetTenants, selectedIds, sentIds]
  );

  const sentCount = useMemo(
    () => targetTenants.filter((t) => sentIds.has(t.id)).length,
    [targetTenants, sentIds]
  );

  const nextTenant = queuedTenants[0] || null;
  const totalQueueCount = sentCount + queuedTenants.length;
  const currentStep = sentCount + 1;

  const previewTenant = nextTenant || targetTenants[0] || null;
  const previewMessage = previewTenant
    ? interpolateMessage(customBody, previewTenant)
    : customBody;

  const nextWaHref = nextTenant
    ? `https://wa.me/${normalizeWhatsAppDigits(
        nextTenant.whatsapp_phone
      )}?text=${encodeURIComponent(interpolateMessage(customBody, nextTenant))}`
    : '#';

  const allFilteredSelected =
    targetTenants.length > 0 &&
    targetTenants.every((t) => selectedIds.has(t.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(targetTenants.map((t) => t.id)));
    }
  };

  const handleResetStatus = () => {
    setSentIds(new Set());
    setSelectedIds(new Set(targetTenants.map((t) => t.id)));
  };

  const handleToggleTenantSelect = (tenantId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tenantId)) {
        next.delete(tenantId);
      } else {
        next.add(tenantId);
      }
      return next;
    });
  };

  const handleToggleSentStatus = (tenantId: string) => {
    const isAlreadySent = sentIds.has(tenantId);
    if (isAlreadySent) {
      setSentIds((prev) => {
        const next = new Set(prev);
        next.delete(tenantId);
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(tenantId);
        return next;
      });
    } else {
      setSentIds((prev) => {
        const next = new Set(prev);
        next.add(tenantId);
        return next;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(tenantId);
        return next;
      });
    }
  };

  const handleSendNext = () => {
    if (!nextTenant) return;
    window.open(nextWaHref, '_blank', 'noopener,noreferrer');
    const sentId = nextTenant.id;
    setSentIds((prev) => {
      const next = new Set(prev);
      next.add(sentId);
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(sentId);
      return next;
    });
  };

  const handleCopyBroadcast = async () => {
    try {
      await navigator.clipboard.writeText(previewMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const allQueueSent =
    targetTenants.length > 0 && queuedTenants.length === 0 && sentCount > 0;

  return (
    <div className="min-h-full">
      <MobileShellHeader
        title="Announcements"
        subtitle={`Personalized WhatsApp Queue · ${formatBillingMonthLabel(billingMonth)}`}
        onBack={onBack}
        rightSlot={
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white">
            <Users className="w-3.5 h-3.5" />
            <span>{targetTenants.length}</span>
          </span>
        }
      />

      <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-36 min-h-[calc(100vh-120px)] space-y-4">
        {/* Audience Selector */}
        <section className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[#0f172a]">
            <Megaphone className="w-4 h-4 text-[#489E44]" />
            <span>1. Select Recipients</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-gray-200/70">
            <button
              type="button"
              onClick={() => setAudience('ALL_ACTIVE')}
              className={`py-2 px-2 rounded-lg text-[11px] font-semibold cursor-pointer min-h-[38px] ${
                audience === 'ALL_ACTIVE'
                  ? 'bg-white text-[#0f172a] shadow-2xs'
                  : 'text-gray-600'
              }`}
            >
              All Active
            </button>
            <button
              type="button"
              onClick={() => setAudience('HOUSE')}
              className={`py-2 px-2 rounded-lg text-[11px] font-semibold cursor-pointer min-h-[38px] ${
                audience === 'HOUSE'
                  ? 'bg-white text-[#0f172a] shadow-2xs'
                  : 'text-gray-600'
              }`}
            >
              By House
            </button>
            <button
              type="button"
              onClick={() => setAudience('EXPIRING_SOON')}
              className={`py-2 px-2 rounded-lg text-[11px] font-semibold cursor-pointer min-h-[38px] ${
                audience === 'EXPIRING_SOON'
                  ? 'bg-white text-[#0f172a] shadow-2xs'
                  : 'text-gray-600'
              }`}
            >
              Expiring
            </button>
          </div>

          {audience === 'HOUSE' && (
            <select
              aria-label="Select House for Announcement"
              value={selectedPropertyId}
              onChange={(e) => onChangeSelectedPropertyId(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-[#0f172a] min-h-[42px]"
            >
              <option value="ALL">All Houses ({properties.length})</option>
              {properties.map((p) => (
                <option key={p.property_id} value={p.property_id}>
                  {p.property_name}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* Notice Template, Variable Chips & Live Preview */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#0f172a]">
              2. Compose Personalized Notice
            </span>
            <button
              type="button"
              onClick={handleCopyBroadcast}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-[#0f172a] hover:bg-gray-100 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-[#489E44]" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy Preview</span>
                </>
              )}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'rent_reminder', label: 'Rent Reminder' },
                { id: 'water_tank', label: 'Water Tank Notice' },
                { id: 'maintenance_notice', label: 'Maint Update' },
                { id: 'custom', label: 'Custom' },
              ] as const
            ).map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl.id)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold border cursor-pointer transition-colors ${
                  templateId === tpl.id
                    ? 'border-[#489E44] bg-emerald-50 text-[#3E8E41]'
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {tpl.label}
              </button>
            ))}
          </div>

          <textarea
            ref={textareaRef}
            rows={5}
            value={customBody}
            onChange={(e) => {
              setTemplateId('custom');
              setCustomBody(e.target.value);
            }}
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-3 text-xs text-[#0f172a] leading-relaxed focus:border-[#489E44] focus:outline-none"
          />

          {/* Clickable Personalization Variable Chips */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Tap variable to insert at cursor
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => handleInsertVariable(token)}
                  className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-2 py-1 text-[11px] font-mono font-semibold text-[#3E8E41] hover:bg-emerald-100 cursor-pointer"
                >
                  {token}
                </button>
              ))}
            </div>
          </div>

          {/* Compact Live Preview */}
          {previewTenant && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/90 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-[#0f172a] truncate">
                  Live Preview ({previewTenant.full_name})
                </span>
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3E8E41] cursor-pointer shrink-0"
                >
                  {showPreview ? (
                    <>
                      <EyeOff className="w-3 h-3" />
                      <span>Hide</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3 h-3" />
                      <span>Show</span>
                    </>
                  )}
                </button>
              </div>
              {showPreview && (
                <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                  {previewMessage}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Multi-Select Resident List */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Send to Residents ({targetTenants.length})
            </h2>
            {targetTenants.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0f172a] hover:bg-gray-50 cursor-pointer"
                >
                  {allFilteredSelected ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  type="button"
                  onClick={handleResetStatus}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Status</span>
                </button>
              </div>
            )}
          </div>

          {targetTenants.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6 text-center text-xs text-gray-500">
              No active tenants match the selected audience filter.
            </div>
          ) : (
            <div className="space-y-2.5">
              {targetTenants.map((tenant) => {
                const prop = properties.find(
                  (p) => p.property_id === tenant.property_id
                );
                const unit = units.find((u) => u.unit_id === tenant.unit_id);
                const { rentAmount, utilityAmount, totalDue } =
                  getTenantFinancials(tenant);
                const isSelected = selectedIds.has(tenant.id);
                const isSent = sentIds.has(tenant.id);
                const isUpNext = nextTenant?.id === tenant.id;

                return (
                  <div
                    key={tenant.id}
                    className={`rounded-2xl border p-3 shadow-2xs flex items-center justify-between gap-2.5 transition-colors ${
                      isUpNext
                        ? 'border-[#489E44] bg-emerald-50/30'
                        : isSent
                          ? 'border-emerald-100 bg-gray-50/70'
                          : 'border-gray-100 bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleTenantSelect(tenant.id)}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer min-h-[44px]"
                      aria-label={`Select ${tenant.full_name}`}
                    >
                      <span className="shrink-0 text-[#489E44]">
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-300" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-[#0f172a] truncate">
                          {tenant.full_name}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {prop?.property_name || 'N/A'} ·{' '}
                          {unit?.unit_name || 'N/A'} ({unit?.floor || ''})
                        </div>
                        <div className="text-[11px] font-mono text-gray-500 mt-0.5 tabular-nums truncate">
                          Rent ₹{Math.round(rentAmount).toLocaleString('en-IN')} ·
                          Util ₹{Math.round(utilityAmount).toLocaleString('en-IN')}{' '}
                          · Due{' '}
                          <strong className="text-[#0f172a]">
                            ₹{Math.round(totalDue).toLocaleString('en-IN')}
                          </strong>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleSentStatus(tenant.id)}
                      className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[11px] font-bold cursor-pointer min-h-[34px] transition-colors ${
                        isSent
                          ? 'border-emerald-200 bg-emerald-50 text-[#3E8E41]'
                          : isUpNext
                            ? 'border-[#489E44] bg-[#489E44] text-white'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                      }`}
                      title="Tap to toggle Sent / Pending"
                    >
                      {isSent ? 'Sent ✓' : isUpNext ? 'Up Next' : 'Pending'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Sticky Bottom Guided Queue Bar */}
      <div className="fixed bottom-16 left-0 right-0 z-30 print:hidden">
        <div className="max-w-md mx-auto bg-white/95 backdrop-blur-md border-t border-gray-200 px-4 py-2.5 shadow-sm">
          {allQueueSent ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#3E8E41]">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="w-4 h-4 text-[#489E44]" />
                </span>
                <span>All {sentCount} Notices Sent ✓</span>
              </div>
              <button
                type="button"
                onClick={handleResetStatus}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-bold text-[#0f172a] hover:bg-gray-50 cursor-pointer min-h-[44px]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Queue</span>
              </button>
            </div>
          ) : nextTenant ? (
            <button
              type="button"
              onClick={handleSendNext}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl bg-[#489E44] hover:bg-[#3E8E41] px-4 py-3 text-sm font-semibold text-white shadow-xs active:scale-[0.99] transition-transform cursor-pointer"
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span className="truncate">
                Send Next via WhatsApp ({currentStep} of {totalQueueCount}):{' '}
                {nextTenant.full_name}
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl bg-gray-200 px-4 py-3 text-sm font-semibold text-gray-500 cursor-not-allowed"
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span>Select Residents to Send</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
