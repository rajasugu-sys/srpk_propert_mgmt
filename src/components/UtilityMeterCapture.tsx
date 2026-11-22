import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Droplets,
  Gauge,
  Loader2,
  Zap,
} from 'lucide-react';
import {
  PropertyHouse,
  TenantRecord,
  Unit,
  UtilityReading,
} from '../types/estate';
import {
  formatBillingMonthLabel,
  formatINR,
  getFloorSortRank,
} from '../utils/billingEngine';
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
  onSaveUtilityReading?: (reading: UtilityReading, isNew: boolean) => void;
  onSaveUtilityReadingsBatch?: (readings: UtilityReading[]) => void;
}

interface UnitMeterDraft {
  ebBillAmount: string;
  prevReading1: string;
  currReading1: string;
  prevReading2: string;
  currReading2: string;
  isDirty: boolean;
  ebOcrNote: string | null;
  waterOcrNote: string | null;
  errorMsg: string | null;
}

function buildInitialDraftForUnit(
  unit: Unit,
  billingMonth: string,
  utilityReadings: UtilityReading[]
): UnitMeterDraft {
  const existing = utilityReadings.find(
    (r) => r.unit_id === unit.unit_id && r.billing_month === billingMonth
  );

  if (existing) {
    return {
      ebBillAmount: String(existing.eb_bill_amount),
      prevReading1: String(existing.prev_reading_1),
      currReading1: String(existing.curr_reading_1),
      prevReading2: String(existing.prev_reading_2),
      currReading2: String(existing.curr_reading_2),
      isDirty: false,
      ebOcrNote: null,
      waterOcrNote: null,
      errorMsg: null,
    };
  }

  const priorReadings = utilityReadings
    .filter((r) => r.unit_id === unit.unit_id && r.billing_month < billingMonth)
    .sort((a, b) => b.billing_month.localeCompare(a.billing_month));

  const prev1 =
    priorReadings[0]?.curr_reading_1 ?? unit.last_water_reading_1 ?? 0;
  const prev2 =
    priorReadings[0]?.curr_reading_2 ?? unit.last_water_reading_2 ?? 0;

  return {
    ebBillAmount: '0',
    prevReading1: String(prev1),
    currReading1: String(prev1),
    prevReading2: String(prev2),
    currReading2: String(prev2),
    isDirty: false,
    ebOcrNote: null,
    waterOcrNote: null,
    errorMsg: null,
  };
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
  onSaveUtilityReadingsBatch,
}) => {
  const [floorFilter, setFloorFilter] = useState<string>('ALL');
  const [drafts, setDrafts] = useState<Record<string, UnitMeterDraft>>({});
  const [ocrBusyKey, setOcrBusyKey] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [highlightedUnitId, setHighlightedUnitId] = useState<string | null>(
    initialUnitId || null
  );

  const unitCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastMonthRef = useRef<string>(billingMonth);

  useEffect(() => {
    if (initialUnitId) {
      const target = units.find((u) => u.unit_id === initialUnitId);
      if (target) {
        onChangeSelectedPropertyId(target.property_id);
        setFloorFilter('ALL');
        setHighlightedUnitId(target.unit_id);
        window.setTimeout(() => {
          unitCardRefs.current[target.unit_id]?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 120);
      }
    }
  }, [initialUnitId, units]);

  // Seed / refresh clean drafts when billingMonth, units, or utilityReadings change
  useEffect(() => {
    const monthChanged = lastMonthRef.current !== billingMonth;
    lastMonthRef.current = billingMonth;

    setDrafts((prevDrafts) => {
      const next: Record<string, UnitMeterDraft> = {};
      units.forEach((unit) => {
        const currentDraft = prevDrafts[unit.unit_id];
        if (!monthChanged && currentDraft && currentDraft.isDirty) {
          next[unit.unit_id] = currentDraft;
        } else {
          next[unit.unit_id] = buildInitialDraftForUnit(
            unit,
            billingMonth,
            utilityReadings
          );
        }
      });
      return next;
    });

    if (monthChanged) {
      setGlobalError(null);
      setSavedToast(null);
    }
  }, [units, utilityReadings, billingMonth]);

  const propertyUnits = useMemo(() => {
    const base =
      selectedPropertyId === 'ALL'
        ? units
        : units.filter((u) => u.property_id === selectedPropertyId);
    return [...base].sort((a, b) => {
      if (a.property_id !== b.property_id) {
        return a.property_id.localeCompare(b.property_id);
      }
      const rankDiff = getFloorSortRank(a.floor) - getFloorSortRank(b.floor);
      if (rankDiff !== 0) return rankDiff;
      return a.unit_name.localeCompare(b.unit_name);
    });
  }, [units, selectedPropertyId]);

  const availableFloors = useMemo(() => {
    const set = new Set<string>();
    propertyUnits.forEach((u) => set.add(u.floor));
    return Array.from(set).sort(
      (a, b) => getFloorSortRank(a) - getFloorSortRank(b)
    );
  }, [propertyUnits]);

  const filteredUnits = useMemo(
    () =>
      floorFilter === 'ALL'
        ? propertyUnits
        : propertyUnits.filter((u) => u.floor === floorFilter),
    [propertyUnits, floorFilter]
  );

  const monthOptions = useMemo(() => {
    const defaults = ['2026-12', '2026-11', '2026-10'];
    return defaults.includes(billingMonth)
      ? defaults
      : [billingMonth, ...defaults];
  }, [billingMonth]);

  const updateDraft = (
    unit: Unit,
    patch: Partial<UnitMeterDraft>,
    markDirty = true
  ) => {
    setDrafts((prev) => {
      const base =
        prev[unit.unit_id] ||
        buildInitialDraftForUnit(unit, billingMonth, utilityReadings);
      return {
        ...prev,
        [unit.unit_id]: {
          ...base,
          ...patch,
          isDirty: markDirty ? true : base.isDirty,
          errorMsg: patch.errorMsg !== undefined ? patch.errorMsg : null,
        },
      };
    });
    setGlobalError(null);
  };

  const handleEbScreenshotUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    unit: Unit
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const key = `${unit.unit_id}:eb`;
    setOcrBusyKey(key);
    updateDraft(unit, { errorMsg: null, ebOcrNote: null }, false);

    try {
      const res = (await extractBillOrMeterWithGemini(file, 'eb_bill')) as EbOcrResult;
      if (typeof res.bill_amount === 'number' && !Number.isNaN(res.bill_amount)) {
        updateDraft(unit, {
          ebBillAmount: String(res.bill_amount),
          ebOcrNote: `Gemini OCR: ${formatINR(res.bill_amount)} (${res.confidence} confidence)${
            res.rr_number ? ` · RR: ${res.rr_number}` : ''
          }`,
          errorMsg: null,
        });
      } else {
        updateDraft(
          unit,
          { errorMsg: 'Could not detect EB bill amount from image.' },
          false
        );
      }
    } catch (err) {
      updateDraft(
        unit,
        { errorMsg: err instanceof Error ? err.message : 'EB OCR failed.' },
        false
      );
    } finally {
      setOcrBusyKey(null);
      e.target.value = '';
    }
  };

  const handleWaterMeterPhoto = async (
    e: React.ChangeEvent<HTMLInputElement>,
    unit: Unit,
    meterIndex: 1 | 2
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const key = `${unit.unit_id}:w${meterIndex}`;
    setOcrBusyKey(key);
    updateDraft(unit, { errorMsg: null, waterOcrNote: null }, false);

    try {
      const res = (await extractBillOrMeterWithGemini(
        file,
        'water_meter'
      )) as WaterMeterOcrResult;
      if (typeof res.meter_reading === 'number' && !Number.isNaN(res.meter_reading)) {
        updateDraft(unit, {
          ...(meterIndex === 1
            ? { currReading1: String(res.meter_reading) }
            : { currReading2: String(res.meter_reading) }),
          waterOcrNote: `Meter #${meterIndex} OCR: ${res.meter_reading} (${res.confidence} confidence)`,
          errorMsg: null,
        });
      } else {
        updateDraft(
          unit,
          {
            errorMsg: `Could not extract numeric reading for Water Meter #${meterIndex}.`,
          },
          false
        );
      }
    } catch (err) {
      updateDraft(
        unit,
        {
          errorMsg: err instanceof Error ? err.message : 'Water meter OCR failed.',
        },
        false
      );
    } finally {
      setOcrBusyKey(null);
      e.target.value = '';
    }
  };

  const readingMapForMonth = useMemo(() => {
    const map = new Map<string, UtilityReading>();
    utilityReadings.forEach((r) => {
      if (r.billing_month === billingMonth) {
        map.set(r.unit_id, r);
      }
    });
    return map;
  }, [utilityReadings, billingMonth]);

  const dirtyUnits = useMemo(
    () =>
      filteredUnits.filter((u) => drafts[u.unit_id]?.isDirty),
    [filteredUnits, drafts]
  );

  const pendingUnits = useMemo(
    () =>
      filteredUnits.filter((u) => !readingMapForMonth.has(u.unit_id)),
    [filteredUnits, readingMapForMonth]
  );

  const unitsToSave = useMemo(() => {
    if (dirtyUnits.length > 0) return dirtyUnits;
    if (pendingUnits.length > 0) return pendingUnits;
    return filteredUnits;
  }, [dirtyUnits, pendingUnits, filteredUnits]);

  const handleSaveAll = () => {
    if (unitsToSave.length === 0) return;
    setGlobalError(null);
    setSavedToast(null);

    const invalidUnits: Array<{ unit: Unit; message: string }> = [];
    const recordsToSave: UtilityReading[] = [];

    for (const unit of unitsToSave) {
      const draft =
        drafts[unit.unit_id] ||
        buildInitialDraftForUnit(unit, billingMonth, utilityReadings);
      const existing = readingMapForMonth.get(unit.unit_id) || null;
      const activeTenant = unit.current_tenant_id
        ? tenants.find((t) => t.id === unit.current_tenant_id && t.is_active) || null
        : null;

      const hasMeter2 = Boolean(unit.water_rr_number2);
      const waterRate =
        activeTenant?.water_charge ?? existing?.water_rate ?? 45;

      const prev1Num = Number(draft.prevReading1) || 0;
      const curr1Num = Number(draft.currReading1) || 0;
      const prev2Num = hasMeter2 ? Number(draft.prevReading2) || 0 : 0;
      const curr2Num = hasMeter2 ? Number(draft.currReading2) || 0 : 0;

      if (curr1Num < prev1Num) {
        invalidUnits.push({
          unit,
          message: `Water Meter #1 current (${curr1Num}) cannot be less than previous (${prev1Num}).`,
        });
        continue;
      }
      if (hasMeter2 && curr2Num < prev2Num) {
        invalidUnits.push({
          unit,
          message: `Water Meter #2 current (${curr2Num}) cannot be less than previous (${prev2Num}).`,
        });
        continue;
      }

      const netConsumption =
        Math.max(0, curr1Num - prev1Num) +
        (hasMeter2 ? Math.max(0, curr2Num - prev2Num) : 0);
      const waterBillAmount = Math.round(netConsumption * waterRate);

      recordsToSave.push({
        id:
          existing?.id ||
          `UTIL-${billingMonth.replace('-', '')}-${unit.unit_id.replace('UNIT-', '')}`,
        property_id: unit.property_id,
        unit_id: unit.unit_id,
        billing_month: billingMonth,
        eb_bill_amount: Math.max(0, Number(draft.ebBillAmount) || 0),
        eb_paid_to_owner: existing?.eb_paid_to_owner ?? true,
        prev_reading_1: prev1Num,
        curr_reading_1: curr1Num,
        prev_reading_2: prev2Num,
        curr_reading_2: curr2Num,
        net_consumption: netConsumption,
        water_rate: waterRate,
        water_bill_amount: waterBillAmount,
        captured_at: new Date().toISOString(),
      });
    }

    if (invalidUnits.length > 0) {
      setDrafts((prev) => {
        const next = { ...prev };
        invalidUnits.forEach(({ unit, message }) => {
          const cur =
            next[unit.unit_id] ||
            buildInitialDraftForUnit(unit, billingMonth, utilityReadings);
          next[unit.unit_id] = { ...cur, errorMsg: message };
        });
        return next;
      });
      setGlobalError(
        `Please fix reading errors in ${invalidUnits
          .map((i) => i.unit.unit_name)
          .join(', ')} before saving.`
      );
      unitCardRefs.current[invalidUnits[0].unit.unit_id]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      return;
    }

    if (onSaveUtilityReadingsBatch) {
      onSaveUtilityReadingsBatch(recordsToSave);
    } else if (onSaveUtilityReading) {
      recordsToSave.forEach((rec) => {
        onSaveUtilityReading(rec, !readingMapForMonth.has(rec.unit_id));
      });
    }

    setDrafts((prev) => {
      const next = { ...prev };
      recordsToSave.forEach((rec) => {
        if (next[rec.unit_id]) {
          next[rec.unit_id] = {
            ...next[rec.unit_id],
            isDirty: false,
            errorMsg: null,
          };
        }
      });
      return next;
    });

    const totalEb = recordsToSave.reduce((sum, r) => sum + r.eb_bill_amount, 0);
    const totalWater = recordsToSave.reduce(
      (sum, r) => sum + r.water_bill_amount,
      0
    );

    setSavedToast(
      `Saved ${recordsToSave.length} unit${
        recordsToSave.length === 1 ? '' : 's'
      } for ${formatBillingMonthLabel(billingMonth)} (EB: ${formatINR(
        totalEb
      )}, Water: ${formatINR(totalWater)}).`
    );
    window.setTimeout(() => setSavedToast(null), 5000);
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

  const ctaLabel =
    dirtyUnits.length > 0
      ? `Save All Readings (${dirtyUnits.length} modified)`
      : pendingUnits.length > 0
        ? `Save All Readings (${pendingUnits.length} pending)`
        : `Save All Readings (${filteredUnits.length} units)`;

  return (
    <div className="min-h-full">
      <MobileShellHeader
        title="Utility Meters"
        subtitle="House-level EB & water sub-meters with Gemini OCR"
        onBack={onBack}
        rightSlot={
          <select
            aria-label="Billing Month"
            value={billingMonth}
            onChange={(e) => onChangeBillingMonth(e.target.value)}
            className="rounded-xl bg-white/20 border border-white/30 px-2.5 py-1.5 text-xs font-bold text-white"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m} className="text-[#0f172a]">
                {formatBillingMonthLabel(m)}
              </option>
            ))}
          </select>
        }
      />

      {/* Curved White Lower Sheet */}
      <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-36 min-h-[calc(100vh-120px)] space-y-4">
        {/* House & Floor Filter Bar (No Target Unit dropdown) */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">
              House / Property
            </label>
            <select
              aria-label="House / Property"
              value={selectedPropertyId}
              onChange={(e) => {
                onChangeSelectedPropertyId(e.target.value);
                setFloorFilter('ALL');
              }}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[42px]"
            >
              <option value="ALL">All Houses ({properties.length})</option>
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
              aria-label="Floor"
              value={floorFilter}
              onChange={(e) => setFloorFilter(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[42px]"
            >
              <option value="ALL">All Floors ({propertyUnits.length})</option>
              {availableFloors.map((fl) => (
                <option key={fl} value={fl}>
                  {fl}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status Summary Strip */}
        <div className="flex items-center justify-between px-1 text-[11px] text-gray-500">
          <span>
            Showing <strong className="text-[#0f172a]">{filteredUnits.length}</strong>{' '}
            unit{filteredUnits.length === 1 ? '' : 's'}
          </span>
          <span className="font-semibold">
            <span className="text-[#3E8E41]">
              {filteredUnits.length - pendingUnits.length} saved
            </span>
            {pendingUnits.length > 0 && (
              <span className="text-amber-600"> · {pendingUnits.length} pending</span>
            )}
          </span>
        </div>

        {globalError && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{globalError}</span>
          </div>
        )}

        {savedToast && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
            <Check className="w-4 h-4 text-[#489E44] shrink-0" />
            <span>{savedToast}</span>
          </div>
        )}

        {/* Bulk Unit Cards */}
        {filteredUnits.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6 text-center text-xs text-gray-500">
            No units match the selected House / Floor filter.
          </div>
        ) : (
          <div className="space-y-3.5">
            {filteredUnits.map((unit) => {
              const prop = properties.find(
                (p) => p.property_id === unit.property_id
              );
              const activeTenant = unit.current_tenant_id
                ? tenants.find(
                    (t) => t.id === unit.current_tenant_id && t.is_active
                  ) || null
                : null;
              const existing = readingMapForMonth.get(unit.unit_id) || null;
              const draft =
                drafts[unit.unit_id] ||
                buildInitialDraftForUnit(unit, billingMonth, utilityReadings);

              const hasMeter2 = Boolean(unit.water_rr_number2);
              const waterRate =
                activeTenant?.water_charge ?? existing?.water_rate ?? 45;

              const prev1Num = Number(draft.prevReading1) || 0;
              const curr1Num = Number(draft.currReading1) || 0;
              const prev2Num = hasMeter2 ? Number(draft.prevReading2) || 0 : 0;
              const curr2Num = hasMeter2 ? Number(draft.currReading2) || 0 : 0;

              const netConsumption =
                Math.max(0, curr1Num - prev1Num) +
                (hasMeter2 ? Math.max(0, curr2Num - prev2Num) : 0);
              const waterBillAmount = Math.round(netConsumption * waterRate);

              const isEbBusy = ocrBusyKey === `${unit.unit_id}:eb`;
              const isW1Busy = ocrBusyKey === `${unit.unit_id}:w1`;
              const isW2Busy = ocrBusyKey === `${unit.unit_id}:w2`;
              const isHighlighted = highlightedUnitId === unit.unit_id;

              const statusLabel = draft.isDirty
                ? 'Modified'
                : existing
                  ? 'Saved'
                  : 'Pending';
              const statusClasses = draft.isDirty
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : existing
                  ? 'bg-emerald-50 text-[#3E8E41] border-emerald-200'
                  : 'bg-gray-100 text-gray-600 border-gray-200';

              return (
                <div
                  key={unit.unit_id}
                  ref={(el) => {
                    unitCardRefs.current[unit.unit_id] = el;
                  }}
                  className={`rounded-2xl border bg-white p-3.5 shadow-2xs space-y-3 transition-colors ${
                    draft.errorMsg
                      ? 'border-rose-300'
                      : isHighlighted
                        ? 'border-[#489E44] ring-2 ring-[#489E44]/15'
                        : 'border-gray-200'
                  }`}
                >
                  {/* Card Header: Unit name/type on left, Tenant + status badge on right */}
                  <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-gray-100">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#0f172a] truncate">
                        {unit.unit_name}{' '}
                        <span className="text-xs font-semibold text-gray-500">
                          ({unit.unit_type})
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {selectedPropertyId === 'ALL' && prop
                          ? `${prop.property_name} · `
                          : ''}
                        {unit.floor}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0 max-w-[52%]">
                      <span className="text-xs font-bold text-[#0f172a] truncate max-w-full">
                        {activeTenant ? activeTenant.full_name : 'Unit Vacant'}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClasses}`}
                      >
                        {existing && !draft.isDirty && (
                          <Check className="w-2.5 h-2.5" />
                        )}
                        <span>{statusLabel}</span>
                      </span>
                    </div>
                  </div>

                  {/* Unit EB Section */}
                  <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="text-[11px] font-bold text-[#0f172a] truncate">
                          {prop?.utility_provider || 'BESCOM'} ·{' '}
                          <span className="font-mono">{unit.eb_rr_number}</span>
                        </span>
                      </div>

                      <label className="inline-flex items-center gap-1.5 rounded-xl bg-[#0f172a] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 cursor-pointer shrink-0 min-h-[34px]">
                        {isEbBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Camera className="w-3.5 h-3.5 text-[#489E44]" />
                        )}
                        <span>{isEbBusy ? 'Scanning...' : 'EB Bill OCR'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => void handleEbScreenshotUpload(e, unit)}
                          disabled={Boolean(ocrBusyKey)}
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
                        inputMode="numeric"
                        value={draft.ebBillAmount}
                        onChange={(e) =>
                          updateDraft(unit, { ebBillAmount: e.target.value })
                        }
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono tabular-nums font-bold text-[#0f172a] min-h-[42px]"
                      />
                    </div>

                    {draft.ebOcrNote && (
                      <div className="text-[11px] font-semibold text-[#3E8E41]">
                        {draft.ebOcrNote}
                      </div>
                    )}
                  </div>

                  {/* Water Sub-Meters Section */}
                  <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Droplets className="w-3.5 h-3.5 text-[#489E44] shrink-0" />
                        <span className="text-[11px] font-bold text-[#0f172a]">
                          Water Sub-Meters
                        </span>
                      </div>
                      <span className="text-[11px] font-mono font-semibold text-gray-600">
                        ₹{waterRate}/unit
                      </span>
                    </div>

                    {/* Meter #1 */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-gray-700 font-mono truncate">
                          Meter #1 ({unit.water_rr_number})
                        </span>
                        <label className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0f172a] hover:bg-gray-100 cursor-pointer shrink-0 min-h-[32px]">
                          {isW1Busy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Camera className="w-3 h-3 text-[#489E44]" />
                          )}
                          <span>{isW1Busy ? 'Reading...' : 'Photo OCR'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => void handleWaterMeterPhoto(e, unit, 1)}
                            disabled={Boolean(ocrBusyKey)}
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                            Previous
                          </label>
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={draft.prevReading1}
                            onChange={(e) =>
                              updateDraft(unit, { prevReading1: e.target.value })
                            }
                            className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-sm font-mono tabular-nums text-gray-700 min-h-[40px]"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                            Current
                          </label>
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={draft.currReading1}
                            onChange={(e) =>
                              updateDraft(unit, { currReading1: e.target.value })
                            }
                            className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-sm font-mono tabular-nums font-bold text-[#0f172a] min-h-[40px]"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Optional Meter #2 */}
                    {hasMeter2 && (
                      <div className="space-y-1.5 pt-2.5 border-t border-gray-200/80">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-gray-700 font-mono truncate">
                            Meter #2 ({unit.water_rr_number2})
                          </span>
                          <label className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0f172a] hover:bg-gray-100 cursor-pointer shrink-0 min-h-[32px]">
                            {isW2Busy ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Camera className="w-3 h-3 text-[#489E44]" />
                            )}
                            <span>{isW2Busy ? 'Reading...' : 'Photo OCR'}</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => void handleWaterMeterPhoto(e, unit, 2)}
                              disabled={Boolean(ocrBusyKey)}
                            />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                              Previous #2
                            </label>
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={draft.prevReading2}
                              onChange={(e) =>
                                updateDraft(unit, { prevReading2: e.target.value })
                              }
                              className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-sm font-mono tabular-nums text-gray-700 min-h-[40px]"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                              Current #2
                            </label>
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={draft.currReading2}
                              onChange={(e) =>
                                updateDraft(unit, { currReading2: e.target.value })
                              }
                              className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-sm font-mono tabular-nums font-bold text-[#0f172a] min-h-[40px]"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Live Auto-Calculated Consumption & INR Total */}
                    <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs">
                      <span className="font-mono text-gray-700 tabular-nums">
                        {netConsumption} units × ₹{waterRate}
                      </span>
                      <span className="font-mono font-bold text-[#3E8E41] tabular-nums">
                        {formatINR(waterBillAmount)}
                      </span>
                    </div>

                    {draft.waterOcrNote && (
                      <div className="text-[11px] font-semibold text-[#3E8E41]">
                        {draft.waterOcrNote}
                      </div>
                    )}
                  </div>

                  {draft.errorMsg && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                      {draft.errorMsg}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Captured Readings Summary List */}
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
                    onClick={() => {
                      setHighlightedUnitId(r.unit_id);
                      unitCardRefs.current[r.unit_id]?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                      });
                    }}
                    className="w-full text-left px-4 py-3 flex items-center justify-between text-xs hover:bg-gray-50 cursor-pointer min-h-[48px]"
                  >
                    <div>
                      <div className="font-bold text-[#0f172a]">
                        {p?.property_name ? `${p.property_name} · ` : ''}
                        {u?.unit_name || r.unit_id}
                      </div>
                      <div className="text-gray-500 font-mono mt-0.5 tabular-nums">
                        EB: {formatINR(r.eb_bill_amount)} · Water: {r.net_consumption}u
                      </div>
                    </div>
                    <span className="font-mono font-bold text-[#3E8E41] tabular-nums">
                      {formatINR(r.water_bill_amount)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="fixed bottom-16 left-0 right-0 z-30 print:hidden">
        <div className="max-w-md mx-auto bg-white/95 backdrop-blur-md border-t border-gray-200 px-4 py-2.5 shadow-sm">
          <button
            type="button"
            disabled={filteredUnits.length === 0}
            onClick={handleSaveAll}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl bg-[#489E44] px-5 py-3 text-sm font-semibold text-white hover:bg-[#3E8E41] disabled:bg-gray-300 disabled:text-gray-500 cursor-pointer disabled:cursor-not-allowed shadow-xs active:scale-[0.99] transition-transform"
          >
            <Gauge className="w-4 h-4" />
            <span>{ctaLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
