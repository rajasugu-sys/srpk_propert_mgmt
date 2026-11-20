import React, { useEffect, useMemo, useState } from 'react';
import { Camera, Check, Droplets, Gauge, Loader2, Zap } from 'lucide-react';
import {
  PropertyHouse,
  TenantRecord,
  Unit,
  UtilityReading,
} from '../types/estate';
import { formatBillingMonthLabel, formatINR } from '../utils/billingEngine';
import {
  EbOcrResult,
  extractBillOrMeterWithGemini,
  WaterMeterOcrResult,
} from '../services/ocrService';
import { MobileShellHeader } from './MobileShellHeader';

interface UtilityMeterCaptureProps {
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  utilityReadings: UtilityReading[];
  billingMonth: string;
  selectedPropertyId: string;
  onBack: () => void;
  onChangeBillingMonth: (month: string) => void;
  onChangeSelectedPropertyId: (propertyId: string) => void;
  initialUnitId?: string | null;
  onSaveUtilityReading: (reading: UtilityReading, isNew: boolean) => void;
}

export const UtilityMeterCapture: React.FC<UtilityMeterCaptureProps> = ({
  properties,
  units,
  tenants,
  utilityReadings,
  billingMonth,
  selectedPropertyId,
  onBack,
  onChangeBillingMonth,
  onChangeSelectedPropertyId,
  initialUnitId,
  onSaveUtilityReading,
}) => {
  const [floorFilter, setFloorFilter] = useState<string>('ALL');
  const [selectedUnitId, setSelectedUnitId] = useState<string>(
    initialUnitId || units[0]?.unit_id || ''
  );

  // EB State
  const [ebBillAmount, setEbBillAmount] = useState<string>('0');
  const [ebOcrBusy, setEbOcrBusy] = useState(false);
  const [ebOcrNote, setEbOcrNote] = useState<string | null>(null);

  // Water Meter 1 & optional Water Meter 2 State
  const [prevReading1, setPrevReading1] = useState<string>('0');
  const [currReading1, setCurrReading1] = useState<string>('');
  const [prevReading2, setPrevReading2] = useState<string>('0');
  const [currReading2, setCurrReading2] = useState<string>('0');
  const [w1OcrBusy, setW1OcrBusy] = useState(false);
  const [w2OcrBusy, setW2OcrBusy] = useState(false);
  const [waterOcrNote, setWaterOcrNote] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const propertyUnits = useMemo(
    () =>
      selectedPropertyId === 'ALL'
        ? units
        : units.filter((u) => u.property_id === selectedPropertyId),
    [units, selectedPropertyId]
  );

  const availableFloors = useMemo(() => {
    const set = new Set<string>();
    propertyUnits.forEach((u) => set.add(u.floor));
    return Array.from(set);
  }, [propertyUnits]);

  const filteredUnits = useMemo(
    () =>
      floorFilter === 'ALL'
        ? propertyUnits
        : propertyUnits.filter((u) => u.floor === floorFilter),
    [propertyUnits, floorFilter]
  );

  useEffect(() => {
    if (initialUnitId) {
      const target = units.find((u) => u.unit_id === initialUnitId);
      if (target) {
        onChangeSelectedPropertyId(target.property_id);
        setFloorFilter('ALL');
        setSelectedUnitId(target.unit_id);
      }
    }
  }, [initialUnitId, units]);

  useEffect(() => {
    if (
      filteredUnits.length > 0 &&
      !filteredUnits.some((u) => u.unit_id === selectedUnitId)
    ) {
      setSelectedUnitId(filteredUnits[0].unit_id);
    }
  }, [filteredUnits, selectedUnitId]);

  const activeUnit = useMemo(
    () => units.find((u) => u.unit_id === selectedUnitId) || filteredUnits[0] || units[0],
    [units, filteredUnits, selectedUnitId]
  );

  const activeProperty = useMemo(
    () =>
      activeUnit
        ? properties.find((p) => p.property_id === activeUnit.property_id) || null
        : null,
    [properties, activeUnit]
  );

  const activeTenant = useMemo(
    () =>
      activeUnit?.current_tenant_id
        ? tenants.find((t) => t.id === activeUnit.current_tenant_id && t.is_active) || null
        : null,
    [activeUnit, tenants]
  );

  const existingMonthReading = useMemo(
    () =>
      utilityReadings.find(
        (r) => r.unit_id === activeUnit?.unit_id && r.billing_month === billingMonth
      ) || null,
    [utilityReadings, activeUnit, billingMonth]
  );

  useEffect(() => {
    if (!activeUnit) return;
    setErrorMsg(null);
    setEbOcrNote(null);
    setWaterOcrNote(null);

    if (existingMonthReading) {
      setEbBillAmount(String(existingMonthReading.eb_bill_amount));
      setPrevReading1(String(existingMonthReading.prev_reading_1));
      setCurrReading1(String(existingMonthReading.curr_reading_1));
      setPrevReading2(String(existingMonthReading.prev_reading_2));
      setCurrReading2(String(existingMonthReading.curr_reading_2));
      return;
    }

    const priorReadings = utilityReadings
      .filter((r) => r.unit_id === activeUnit.unit_id && r.billing_month < billingMonth)
      .sort((a, b) => b.billing_month.localeCompare(a.billing_month));

    const prev1 =
      priorReadings[0]?.curr_reading_1 ?? activeUnit.last_water_reading_1 ?? 0;
    const prev2 =
      priorReadings[0]?.curr_reading_2 ?? activeUnit.last_water_reading_2 ?? 0;

    setEbBillAmount('0');
    setPrevReading1(String(prev1));
    setCurrReading1(String(prev1));
    setPrevReading2(String(prev2));
    setCurrReading2(String(prev2));
  }, [activeUnit, existingMonthReading, utilityReadings, billingMonth]);

  const hasMeter2 = Boolean(activeUnit?.water_rr_number2);
  const waterRate = activeTenant?.water_charge ?? 45;

  const prev1Num = Number(prevReading1) || 0;
  const curr1Num = Number(currReading1) || 0;
  const prev2Num = hasMeter2 ? Number(prevReading2) || 0 : 0;
  const curr2Num = hasMeter2 ? Number(currReading2) || 0 : 0;

  const netConsumption =
    Math.max(0, curr1Num - prev1Num) +
    (hasMeter2 ? Math.max(0, curr2Num - prev2Num) : 0);
  const waterBillAmount = Math.round(netConsumption * waterRate);

  const handleEbScreenshotUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEbOcrBusy(true);
    setErrorMsg(null);
    setEbOcrNote(null);

    try {
      const res = (await extractBillOrMeterWithGemini(file, 'eb_bill')) as EbOcrResult;
      if (typeof res.bill_amount === 'number' && !Number.isNaN(res.bill_amount)) {
        setEbBillAmount(String(res.bill_amount));
        setEbOcrNote(
          `Gemini OCR extracted ${formatINR(res.bill_amount)} (${res.confidence} confidence)${
            res.rr_number ? ` · RR: ${res.rr_number}` : ''
          }`
        );
      } else {
        setErrorMsg('Could not detect EB bill amount from image.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'EB OCR failed.');
    } finally {
      setEbOcrBusy(false);
      e.target.value = '';
    }
  };

  const handleWaterMeterPhoto = async (
    e: React.ChangeEvent<HTMLInputElement>,
    meterIndex: 1 | 2
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (meterIndex === 1) setW1OcrBusy(true);
    else setW2OcrBusy(true);
    setErrorMsg(null);
    setWaterOcrNote(null);

    try {
      const res = (await extractBillOrMeterWithGemini(
        file,
        'water_meter'
      )) as WaterMeterOcrResult;
      if (typeof res.meter_reading === 'number' && !Number.isNaN(res.meter_reading)) {
        if (meterIndex === 1) setCurrReading1(String(res.meter_reading));
        else setCurrReading2(String(res.meter_reading));
        setWaterOcrNote(
          `Meter #${meterIndex} OCR reading: ${res.meter_reading} (${res.confidence} confidence)`
        );
      } else {
        setErrorMsg(`Could not extract numeric reading for Water Meter #${meterIndex}.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Water meter OCR failed.');
    } finally {
      if (meterIndex === 1) setW1OcrBusy(false);
      else setW2OcrBusy(false);
      e.target.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUnit) return;
    setErrorMsg(null);

    if (curr1Num < prev1Num) {
      setErrorMsg(
        `Water Meter #1 current reading (${curr1Num}) cannot be less than previous (${prev1Num}).`
      );
      return;
    }
    if (hasMeter2 && curr2Num < prev2Num) {
      setErrorMsg(
        `Water Meter #2 current reading (${curr2Num}) cannot be less than previous (${prev2Num}).`
      );
      return;
    }

    const record: UtilityReading = {
      id:
        existingMonthReading?.id ||
        `UTIL-${billingMonth.replace('-', '')}-${activeUnit.unit_id.replace('UNIT-', '')}`,
      property_id: activeUnit.property_id,
      unit_id: activeUnit.unit_id,
      billing_month: billingMonth,
      eb_bill_amount: Number(ebBillAmount) || 0,
      eb_paid_to_owner: existingMonthReading?.eb_paid_to_owner ?? true,
      prev_reading_1: prev1Num,
      curr_reading_1: curr1Num,
      prev_reading_2: prev2Num,
      curr_reading_2: curr2Num,
      net_consumption: netConsumption,
      water_rate: waterRate,
      water_bill_amount: waterBillAmount,
      captured_at: new Date().toISOString(),
    };

    onSaveUtilityReading(record, !existingMonthReading);
    setSavedToast(
      `Saved ${activeProperty?.property_name || ''} ${activeUnit.unit_name} utilities for ${formatBillingMonthLabel(
        billingMonth
      )} (EB: ${formatINR(record.eb_bill_amount)}, Water: ${formatINR(waterBillAmount)}).`
    );
    setTimeout(() => setSavedToast(null), 4500);
  };

  const monthReadings = useMemo(
    () =>
      utilityReadings.filter((r) => {
        if (r.billing_month !== billingMonth) return false;
        if (selectedPropertyId !== 'ALL' && r.property_id !== selectedPropertyId) {
          return false;
        }
        return true;
      }),
    [utilityReadings, billingMonth, selectedPropertyId]
  );

  return (
    <div className="min-h-full">
      <MobileShellHeader
        title="Utility Meters"
        subtitle="EB bills & water sub-meters with Gemini OCR"
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
          {/* Cascading Selectors */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                  House / Property
                </label>
                <select
                  value={selectedPropertyId}
                  onChange={(e) => {
                    onChangeSelectedPropertyId(e.target.value);
                    setFloorFilter('ALL');
                  }}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[40px]"
                >
                  <option value="ALL">All Houses</option>
                  {properties.map((p) => (
                    <option key={p.property_id} value={p.property_id}>
                      {p.property_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                  Floor
                </label>
                <select
                  value={floorFilter}
                  onChange={(e) => setFloorFilter(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[40px]"
                >
                  <option value="ALL">All Floors</option>
                  {availableFloors.map((fl) => (
                    <option key={fl} value={fl}>
                      {fl}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                Target Unit
              </label>
              <select
                value={activeUnit?.unit_id || ''}
                onChange={(e) => setSelectedUnitId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[42px]"
              >
                {filteredUnits.map((u) => {
                  const p = properties.find((prop) => prop.property_id === u.property_id);
                  return (
                    <option key={u.unit_id} value={u.unit_id}>
                      {selectedPropertyId === 'ALL' && p
                        ? `${p.property_name} · `
                        : ''}
                      {u.unit_name} ({u.unit_type})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* 1. Unit Electricity (BESCOM / TNEB) */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-xs font-bold text-[#0f172a] truncate">
                  Unit EB ({activeProperty?.utility_provider} · {activeUnit?.eb_rr_number})
                </span>
              </div>

              <label className="inline-flex items-center gap-1.5 rounded-xl bg-[#0f172a] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer">
                {ebOcrBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Camera className="w-3.5 h-3.5 text-[#489E44]" />
                )}
                <span>{ebOcrBusy ? 'Scanning...' : 'EB Bill OCR'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleEbScreenshotUpload}
                  disabled={ebOcrBusy}
                />
              </label>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                Unit EB Bill Amount (INR)
              </label>
              <input
                type="number"
                min={0}
                value={ebBillAmount}
                onChange={(e) => setEbBillAmount(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono tabular-nums font-bold text-[#0f172a] min-h-[42px]"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                EB collection mode (Paid to Owner vs Direct) is configured per invoice.
              </p>
            </div>

            {ebOcrNote && (
              <div className="text-xs font-semibold text-[#3E8E41]">{ebOcrNote}</div>
            )}
          </div>

          {/* 2. Water Meter Intake */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Droplets className="w-4 h-4 text-[#489E44]" />
              <span className="text-xs font-bold text-[#0f172a]">
                Water Sub-Meters (Rate: ₹{waterRate}/unit)
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-700 font-mono">
                  Meter #1 ({activeUnit?.water_rr_number})
                </span>
                <label className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0f172a] hover:bg-gray-100 cursor-pointer">
                  {w1OcrBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Camera className="w-3.5 h-3.5 text-[#489E44]" />
                  )}
                  <span>{w1OcrBusy ? 'Reading...' : 'Photo OCR'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleWaterMeterPhoto(e, 1)}
                    disabled={w1OcrBusy}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">
                    Previous #1
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={prevReading1}
                    onChange={(e) => setPrevReading1(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-gray-700"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">
                    Current #1
                  </label>
                  <input
                    type="number"
                    min={prev1Num}
                    value={currReading1}
                    onChange={(e) => setCurrReading1(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                  />
                </div>
              </div>
            </div>

            {hasMeter2 && (
              <div className="space-y-2 pt-3 border-t border-gray-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-700 font-mono">
                    Meter #2 ({activeUnit?.water_rr_number2})
                  </span>
                  <label className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0f172a] hover:bg-gray-100 cursor-pointer">
                    {w2OcrBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5 text-[#489E44]" />
                    )}
                    <span>{w2OcrBusy ? 'Reading...' : 'Photo OCR'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleWaterMeterPhoto(e, 2)}
                      disabled={w2OcrBusy}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">
                      Previous #2
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={prevReading2}
                      onChange={(e) => setPrevReading2(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-gray-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">
                      Current #2
                    </label>
                    <input
                      type="number"
                      min={prev2Num}
                      value={currReading2}
                      onChange={(e) => setCurrReading2(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono font-bold text-[#0f172a]"
                    />
                  </div>
                </div>
              </div>
            )}

            {waterOcrNote && (
              <div className="text-xs font-semibold text-[#3E8E41]">{waterOcrNote}</div>
            )}
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
              {errorMsg}
            </div>
          )}

          {savedToast && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
              <Check className="w-4 h-4 text-[#489E44] shrink-0" />
              <span>{savedToast}</span>
            </div>
          )}

          {/* Live Calculation Summary */}
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-600">Active Tenant</span>
              <span className="font-bold text-[#0f172a]">
                {activeTenant ? activeTenant.full_name : 'Unit Vacant'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">
                Water ({netConsumption} units × ₹{waterRate})
              </span>
              <span className="font-mono font-bold text-[#3E8E41]">
                {formatINR(waterBillAmount)}
              </span>
            </div>
          </div>

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#489E44] px-5 py-3 text-sm font-semibold text-white hover:bg-[#3E8E41] cursor-pointer shadow-xs"
          >
            <Gauge className="w-4 h-4" />
            <span>Save Utility Readings</span>
          </button>
        </form>

        {/* Captured Readings List */}
        <section className="rounded-2xl border border-gray-100 bg-white shadow-2xs overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-xs font-bold text-[#0f172a]">
            Captured {formatBillingMonthLabel(billingMonth)} Readings ({monthReadings.length})
          </div>
          <div className="divide-y divide-gray-100">
            {monthReadings.length === 0 ? (
              <div className="p-5 text-center text-xs text-gray-500">
                No utility readings saved yet for this month.
              </div>
            ) : (
              monthReadings.map((r) => {
                const u = units.find((item) => item.unit_id === r.unit_id);
                const p = properties.find((prop) => prop.property_id === r.property_id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedUnitId(r.unit_id)}
                    className="w-full text-left px-4 py-3 flex items-center justify-between text-xs hover:bg-gray-50 cursor-pointer"
                  >
                    <div>
                      <div className="font-bold text-[#0f172a]">
                        {p?.property_name ? `${p.property_name} · ` : ''}
                        {u?.unit_name || r.unit_id}
                      </div>
                      <div className="text-gray-500 font-mono mt-0.5">
                        EB: {formatINR(r.eb_bill_amount)} · Water: {r.net_consumption}u
                      </div>
                    </div>
                    <span className="font-mono font-bold text-[#3E8E41]">
                      {formatINR(r.water_bill_amount)}
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
