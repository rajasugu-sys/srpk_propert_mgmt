import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Camera,
  Check,
  Loader2,
  Plus,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  AdditionalChargeItem,
  HouseMaintenanceBill,
  PropertyHouse,
  Unit,
} from '../types/estate';
import { formatBillingMonthLabel, formatINR } from '../utils/billingEngine';
import { EbOcrResult, extractBillOrMeterWithGemini } from '../services/ocrService';
import { MobileShellHeader } from './MobileShellHeader';

interface MaintenanceViewProps {
  properties: PropertyHouse[];
  units: Unit[];
  houseMaintenanceBills: HouseMaintenanceBill[];
  billingMonth: string;
  initialPropertyId?: string | null;
  onBack: () => void;
  onChangeBillingMonth: (month: string) => void;
  onSaveHouseMaintenanceBill: (bill: HouseMaintenanceBill, isEdit: boolean) => void;
  isReadOnly?: boolean;
}

export const MaintenanceView: React.FC<MaintenanceViewProps> = ({
  properties,
  units,
  houseMaintenanceBills,
  billingMonth,
  initialPropertyId,
  onBack,
  onChangeBillingMonth,
  onSaveHouseMaintenanceBill,
  isReadOnly = false,
}) => {
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>(
    initialPropertyId || properties[0]?.property_id || ''
  );
  const [commonEbAmount, setCommonEbAmount] = useState<string>('0');
  const [additionalCharges, setAdditionalCharges] = useState<AdditionalChargeItem[]>([]);
  const [newChargeName, setNewChargeName] = useState('');
  const [newChargeAmount, setNewChargeAmount] = useState('');

  const [isScanningOcr, setIsScanningOcr] = useState(false);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    if (
      initialPropertyId &&
      properties.some((p) => p.property_id === initialPropertyId)
    ) {
      setSelectedPropertyId(initialPropertyId);
    }
  }, [initialPropertyId, properties]);

  const activeProperty = useMemo(
    () =>
      properties.find((p) => p.property_id === selectedPropertyId) || properties[0],
    [properties, selectedPropertyId]
  );

  const existingBill = useMemo(
    () =>
      houseMaintenanceBills.find(
        (m) =>
          m.property_id === selectedPropertyId && m.billing_month === billingMonth
      ) || null,
    [houseMaintenanceBills, selectedPropertyId, billingMonth]
  );

  useEffect(() => {
    if (existingBill) {
      setCommonEbAmount(String(existingBill.common_eb_amount));
      setAdditionalCharges(existingBill.additional_charges);
    } else {
      setCommonEbAmount('0');
      setAdditionalCharges([]);
    }
    setOcrMessage(null);
    setOcrError(null);
  }, [existingBill, selectedPropertyId, billingMonth]);

  const totalHouseMaintenance = useMemo(() => {
    const eb = Number(commonEbAmount) || 0;
    const extra = additionalCharges.reduce(
      (s, c) => s + (Number(c.charge_amount) || 0),
      0
    );
    return Math.round(eb + extra);
  }, [commonEbAmount, additionalCharges]);

  const houseUnitCount = useMemo(
    () => units.filter((u) => u.property_id === selectedPropertyId).length,
    [units, selectedPropertyId]
  );

  const perUnitShare = useMemo(
    () =>
      houseUnitCount > 0 ? Math.round(totalHouseMaintenance / houseUnitCount) : 0,
    [totalHouseMaintenance, houseUnitCount]
  );

  const handleUploadCommonEbScreenshot = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanningOcr(true);
    setOcrError(null);
    setOcrMessage(null);

    try {
      const result = (await extractBillOrMeterWithGemini(file, 'common_eb')) as EbOcrResult;
      if (typeof result.bill_amount === 'number' && !Number.isNaN(result.bill_amount)) {
        setCommonEbAmount(String(result.bill_amount));
        setOcrMessage(
          `Gemini OCR extracted ${formatINR(result.bill_amount)} (${result.confidence} confidence)${
            result.rr_number ? ` · RR: ${result.rr_number}` : ''
          }`
        );
      } else {
        setOcrError('Could not detect a payable amount from the uploaded Common EB bill.');
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'OCR extraction failed.');
    } finally {
      setIsScanningOcr(false);
      e.target.value = '';
    }
  };

  const handleAddCharge = () => {
    const amt = Number(newChargeAmount);
    if (!newChargeName.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setAdditionalCharges((prev) => [
      ...prev,
      {
        id: `hc-${Date.now().toString().slice(-5)}`,
        charge_name: newChargeName.trim(),
        charge_amount: amt,
      },
    ]);
    setNewChargeName('');
    setNewChargeAmount('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || !selectedPropertyId) return;

    const bill: HouseMaintenanceBill = {
      id:
        existingBill?.id ||
        `HMAINT-${billingMonth.replace('-', '')}-${selectedPropertyId.replace('PROP-', '')}`,
      property_id: selectedPropertyId,
      billing_month: billingMonth,
      common_eb_amount: Number(commonEbAmount) || 0,
      additional_charges: additionalCharges,
      total_house_maintenance: totalHouseMaintenance,
      updated_at: new Date().toISOString(),
    };

    onSaveHouseMaintenanceBill(bill, Boolean(existingBill));
    setSavedToast(
      `${existingBill ? 'Updated' : 'Created'} House Maintenance bill for ${
        activeProperty?.property_name || selectedPropertyId
      } (${formatBillingMonthLabel(billingMonth)} — ${formatINR(
        totalHouseMaintenance
      )}).`
    );
    setTimeout(() => setSavedToast(null), 4000);
  };

  const monthBills = useMemo(
    () => houseMaintenanceBills.filter((m) => m.billing_month === billingMonth),
    [houseMaintenanceBills, billingMonth]
  );

  return (
    <div className="min-h-full">
      <MobileShellHeader
        title="Building Maintenance"
        subtitle="Shared house bills divided equally per unit"
        onBack={onBack}
        rightSlot={
          <select
            aria-label="Billing Month"
            value={billingMonth}
            onChange={(e) => onChangeBillingMonth(e.target.value)}
            className="rounded-xl bg-white/20 border border-white/30 px-2.5 py-1.5 text-xs font-bold text-white"
          >
            <option value="2026-12" className="text-[#0f172a]">Dec 2026</option>
            <option value="2026-11" className="text-[#0f172a]">Nov 2026</option>
            <option value="2026-10" className="text-[#0f172a]">Oct 2026</option>
          </select>
        }
      />

      {/* Curved White Lower Sheet */}
      <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[calc(100vh-120px)] space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          {isReadOnly && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900">
              View-only mode: Building maintenance charges cannot be edited with Viewer access.
            </div>
          )}

          {existingBill && !isReadOnly && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong>Editing Existing Bill:</strong> {activeProperty?.property_name} ·{' '}
                {formatBillingMonthLabel(billingMonth)} ({existingBill.id})
              </div>
            </div>
          )}

          {/* House / Property Selector */}
          <div>
            <label
              htmlFor="maint-property-select"
              className="block text-xs font-semibold text-gray-700 mb-1"
            >
              Select House / Property
            </label>
            <select
              id="maint-property-select"
              value={selectedPropertyId}
              onChange={(e) => setSelectedPropertyId(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-semibold text-[#0f172a] min-h-[42px]"
            >
              {properties.map((p) => {
                const hasBill = houseMaintenanceBills.some(
                  (m) =>
                    m.property_id === p.property_id && m.billing_month === billingMonth
                );
                return (
                  <option key={p.property_id} value={p.property_id}>
                    {p.property_name} (RR: {p.common_eb_rr_number}){' '}
                    {hasBill ? '— [Saved]' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Common Area Electricity + Gemini OCR Upload */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <label
                  htmlFor="common-eb-amount"
                  className="block text-xs font-bold text-[#0f172a]"
                >
                  Common EB ({activeProperty?.utility_provider})
                </label>
                <div className="text-[11px] font-mono text-gray-500">
                  RR: {activeProperty?.common_eb_rr_number}
                </div>
              </div>

              {!isReadOnly && (
                <label className="inline-flex items-center gap-1.5 rounded-xl bg-[#0f172a] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer">
                  {isScanningOcr ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Camera className="w-3.5 h-3.5 text-[#489E44]" />
                  )}
                  <span>{isScanningOcr ? 'Extracting...' : 'Scan Common EB'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleUploadCommonEbScreenshot}
                    disabled={isScanningOcr}
                  />
                </label>
              )}
            </div>

            <input
              id="common-eb-amount"
              type="number"
              min={0}
              step="1"
              disabled={isReadOnly}
              value={commonEbAmount}
              onChange={(e) => setCommonEbAmount(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-base font-mono tabular-nums font-bold text-[#0f172a] disabled:bg-gray-100 disabled:text-gray-600"
            />

            {ocrMessage && (
              <div className="text-xs font-semibold text-[#3E8E41]">{ocrMessage}</div>
            )}
            {ocrError && (
              <div className="text-xs font-semibold text-rose-600">{ocrError}</div>
            )}
          </div>

          {/* Dynamic Additional Charges */}
          <div className="space-y-2.5">
            <div className="text-xs font-bold text-[#0f172a]">
              Additional Shared Building Expenses
            </div>

            {additionalCharges.length > 0 && (
              <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 overflow-hidden">
                {additionalCharges.map((chg) => (
                  <div
                    key={chg.id}
                    className="flex items-center justify-between px-3.5 py-2.5 text-xs bg-white"
                  >
                    <span className="font-medium text-[#0f172a]">{chg.charge_name}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-[#0f172a]">
                        {formatINR(chg.charge_amount)}
                      </span>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            setAdditionalCharges((prev) =>
                              prev.filter((c) => c.id !== chg.id)
                            )
                          }
                          className="text-gray-400 hover:text-rose-600 cursor-pointer"
                          aria-label="Remove charge"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isReadOnly && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newChargeName}
                  onChange={(e) => setNewChargeName(e.target.value)}
                  placeholder="Sump / Tank cleaning..."
                  className="flex-1 min-w-0 rounded-xl border border-gray-200 px-3 py-2 text-xs text-[#0f172a]"
                />
                <input
                  type="number"
                  min={0}
                  value={newChargeAmount}
                  onChange={(e) => setNewChargeAmount(e.target.value)}
                  placeholder="INR"
                  className="w-20 rounded-xl border border-gray-200 px-2.5 py-2 text-xs font-mono text-[#0f172a]"
                />
                <button
                  type="button"
                  onClick={handleAddCharge}
                  className="inline-flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-[#0f172a] hover:bg-gray-200 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {savedToast && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
              <Check className="w-4 h-4 text-[#489E44] shrink-0" />
              <span>{savedToast}</span>
            </div>
          )}

          {/* Equal Per-Unit Share Card */}
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-[#0f172a]">
                Equal Per-Unit Share
              </div>
              <div className="text-[11px] text-gray-600 font-mono mt-0.5">
                {formatINR(totalHouseMaintenance)} ÷ {houseUnitCount} units
              </div>
            </div>
            <div className="text-lg font-extrabold text-[#3E8E41] font-mono">
              {formatINR(perUnitShare)}/u
            </div>
          </div>

          {!isReadOnly && (
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#489E44] px-5 py-3 text-sm font-semibold text-white hover:bg-[#3E8E41] cursor-pointer shadow-xs"
            >
              <Wrench className="w-4 h-4" />
              <span>
                {existingBill ? 'Update House Bill' : 'Save Building Maint Bill'}
              </span>
            </button>
          )}
        </form>

        {/* Month Ledger */}
        <section className="rounded-2xl border border-gray-100 bg-white shadow-2xs overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-xs font-bold text-[#0f172a]">
            {formatBillingMonthLabel(billingMonth)} Ledger ({monthBills.length})
          </div>
          <div className="divide-y divide-gray-100">
            {monthBills.length === 0 ? (
              <div className="p-5 text-center text-xs text-gray-500">
                No building maintenance bills logged for {formatBillingMonthLabel(billingMonth)}.
              </div>
            ) : (
              monthBills.map((bill) => {
                const prop = properties.find((p) => p.property_id === bill.property_id);
                const unitCount = units.filter(
                  (u) => u.property_id === bill.property_id
                ).length;
                const unitShare =
                  unitCount > 0
                    ? Math.round(bill.total_house_maintenance / unitCount)
                    : 0;
                const isSelected = bill.property_id === selectedPropertyId;

                return (
                  <button
                    key={bill.id}
                    type="button"
                    onClick={() => setSelectedPropertyId(bill.property_id)}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50 cursor-pointer ${
                      isSelected ? 'bg-emerald-50/60' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Building2 className="w-4 h-4 text-[#489E44] mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#0f172a] truncate">
                          {prop?.property_name || bill.property_id}
                        </div>
                        <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                          {formatINR(unitShare)}/unit ({unitCount} units)
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-bold text-[#0f172a] shrink-0">
                      {formatINR(bill.total_house_maintenance)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
