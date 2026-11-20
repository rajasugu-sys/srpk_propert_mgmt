import React, { useMemo, useState } from 'react';
import { Check, Copy, Megaphone, MessageSquare, Users } from 'lucide-react';
import { PropertyHouse, TenantRecord, Unit } from '../types/estate';
import {
  calculateLeaseEndDate,
  getTenureRemainingInfo,
  normalizeWhatsAppDigits,
} from '../utils/billingEngine';
import { MobileShellHeader } from './MobileShellHeader';

interface AnnouncementsViewProps {
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  selectedPropertyId: string;
  onChangeSelectedPropertyId: (propertyId: string) => void;
  onBack: () => void;
}

type AudienceFilter = 'ALL_ACTIVE' | 'EXPIRING_SOON' | 'HOUSE';
type TemplateId = 'rent_reminder' | 'water_tank' | 'maintenance_notice' | 'custom';

export const AnnouncementsView: React.FC<AnnouncementsViewProps> = ({
  properties,
  units,
  tenants,
  selectedPropertyId,
  onChangeSelectedPropertyId,
  onBack,
}) => {
  const [audience, setAudience] = useState<AudienceFilter>('ALL_ACTIVE');
  const [templateId, setTemplateId] = useState<TemplateId>('rent_reminder');
  const [customBody, setCustomBody] = useState(
    'Dear Tenant,\n\nThis is a friendly reminder regarding your monthly rent & utility billing for this month. Please share payment confirmation once completed.\n\nThank you — SRPK Estate Management'
  );
  const [copied, setCopied] = useState(false);

  const applyTemplate = (id: TemplateId) => {
    setTemplateId(id);
    if (id === 'rent_reminder') {
      setCustomBody(
        'Dear Tenant,\n\nThis is a friendly reminder regarding your monthly rent & utility billing for this month. Please share payment confirmation once completed.\n\nThank you — SRPK Estate Management'
      );
    } else if (id === 'water_tank') {
      setCustomBody(
        'Notice: Overhead Tank & Sump Cleaning\n\nDear Residents,\nScheduled sump & overhead tank cleaning will take place this weekend between 10:00 AM and 1:00 PM. Kindly store sufficient water in advance.\n\nThank you — SRPK Estate Management'
      );
    } else if (id === 'maintenance_notice') {
      setCustomBody(
        'Building Maintenance Update\n\nDear Residents,\nCommon area maintenance and meter reading inspection is scheduled shortly. Thank you for your cooperation.\n\nRegards — SRPK Estate Management'
      );
    }
  };

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

  const handleCopyBroadcast = async () => {
    try {
      await navigator.clipboard.writeText(customBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="min-h-full">
      <MobileShellHeader
        title="Announcements"
        subtitle="Broadcast WhatsApp notices to residents"
        onBack={onBack}
        rightSlot={
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white">
            <Users className="w-3.5 h-3.5" />
            <span>{targetTenants.length}</span>
          </span>
        }
      />

      <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[calc(100vh-120px)] space-y-4">
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
              className={`py-2 px-2 rounded-lg text-[11px] font-semibold cursor-pointer ${
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
              className={`py-2 px-2 rounded-lg text-[11px] font-semibold cursor-pointer ${
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
              className={`py-2 px-2 rounded-lg text-[11px] font-semibold cursor-pointer ${
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

        {/* Notice Template & Composer */}
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#0f172a]">
              2. Compose WhatsApp Notice
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
                  <span>Copy Text</span>
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
            rows={5}
            value={customBody}
            onChange={(e) => {
              setTemplateId('custom');
              setCustomBody(e.target.value);
            }}
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-3 text-xs text-[#0f172a] leading-relaxed focus:border-[#489E44] focus:outline-none"
          />
        </section>

        {/* Recipient List with 1-Tap Personalized WhatsApp Links */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Send to Residents ({targetTenants.length})
            </h2>
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
                const personalized = `*${prop?.property_name || 'SRPK Estate'} · ${
                  unit?.unit_name || ''
                }*\nHi *${tenant.full_name}*,\n\n${customBody}`;
                const waHref = `https://wa.me/${normalizeWhatsAppDigits(
                  tenant.whatsapp_phone
                )}?text=${encodeURIComponent(personalized)}`;

                return (
                  <div
                    key={tenant.id}
                    className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-2xs flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#0f172a] truncate">
                        {tenant.full_name}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {prop?.property_name} · {unit?.unit_name} ({unit?.floor})
                      </div>
                      <div className="text-[11px] font-mono text-gray-400 mt-0.5">
                        {tenant.whatsapp_phone}
                      </div>
                    </div>

                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#489E44] hover:bg-[#3E8E41] px-3 py-2 text-xs font-semibold text-white shrink-0 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
