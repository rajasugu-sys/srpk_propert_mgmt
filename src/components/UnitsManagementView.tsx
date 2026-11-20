import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Home,
  MapPin,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  PropertyHouse,
  TenantRecord,
  Unit,
  UnitStatus,
  UtilityProvider,
} from '../types/estate';
import { getFloorSortRank } from '../utils/billingEngine';
import { MobileShellHeader } from './MobileShellHeader';

interface UnitsManagementViewProps {
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  selectedPropertyId: string;
  initialTab?: 'properties' | 'units';
  onBack: () => void;
  onChangeSelectedPropertyId: (propertyId: string) => void;
  onSaveProperty: (property: PropertyHouse, isNew: boolean) => void;
  onDeleteProperty: (propertyId: string) => void;
  onSaveUnit: (unit: Unit, isNew: boolean) => void;
  onDeleteUnit: (unitId: string) => void;
}

export const UnitsManagementView: React.FC<UnitsManagementViewProps> = ({
  properties,
  units,
  tenants,
  selectedPropertyId,
  initialTab = 'properties',
  onBack,
  onChangeSelectedPropertyId,
  onSaveProperty,
  onDeleteProperty,
  onSaveUnit,
  onDeleteUnit,
}) => {
  const [activeTab, setActiveTab] = useState<'properties' | 'units'>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // House (Property) Modal State
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState('');
  const [address, setAddress] = useState('');
  const [totalFloors, setTotalFloors] = useState('3');
  const [commonEbRrNumber, setCommonEbRrNumber] = useState('');
  const [utilityProvider, setUtilityProvider] = useState<UtilityProvider>('BESCOM');
  const [propertyFormError, setPropertyFormError] = useState<string | null>(null);

  // Unit Modal State
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [parentPropertyId, setParentPropertyId] = useState<string>(
    properties[0]?.property_id || ''
  );
  const [unitName, setUnitName] = useState('');
  const [unitType, setUnitType] = useState('2BHK');
  const [floor, setFloor] = useState('Ground Floor');
  const [ebRrNumber, setEbRrNumber] = useState('');
  const [waterRrNumber, setWaterRrNumber] = useState('');
  const [waterRrNumber2, setWaterRrNumber2] = useState('');
  const [status, setStatus] = useState<UnitStatus>('VACANT');
  const [unitFormError, setUnitFormError] = useState<string | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    | { type: 'property'; id: string; name: string }
    | { type: 'unit'; id: string; name: string }
    | null
  >(null);

  const visibleProperties = useMemo(
    () =>
      selectedPropertyId === 'ALL'
        ? properties
        : properties.filter((p) => p.property_id === selectedPropertyId),
    [properties, selectedPropertyId]
  );

  // Property Modal Handlers
  const openAddPropertyModal = () => {
    setEditingPropertyId(null);
    setPropertyName('');
    setAddress('');
    setTotalFloors('3');
    setCommonEbRrNumber('');
    setUtilityProvider('BESCOM');
    setPropertyFormError(null);
    setShowPropertyModal(true);
  };

  const openEditPropertyModal = (prop: PropertyHouse) => {
    setEditingPropertyId(prop.property_id);
    setPropertyName(prop.property_name);
    setAddress(prop.address);
    setTotalFloors(String(prop.total_floors));
    setCommonEbRrNumber(prop.common_eb_rr_number);
    setUtilityProvider(prop.utility_provider);
    setPropertyFormError(null);
    setShowPropertyModal(true);
  };

  const handlePropertySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPropertyFormError(null);
    const floorsNum = Number(totalFloors);
    if (!propertyName.trim() || !commonEbRrNumber.trim() || !floorsNum || floorsNum < 1) {
      setPropertyFormError(
        'Property Name, Total Floors (>=1), and Common EB RR Number are required.'
      );
      return;
    }

    const existing = editingPropertyId
      ? properties.find((p) => p.property_id === editingPropertyId)
      : undefined;

    const nextProp: PropertyHouse = {
      property_id:
        existing?.property_id || `PROP-${Date.now().toString().slice(-5)}`,
      property_name: propertyName.trim(),
      address: address.trim() || 'Address pending',
      total_floors: floorsNum,
      common_eb_rr_number: commonEbRrNumber.trim(),
      utility_provider: utilityProvider,
    };

    onSaveProperty(nextProp, !existing);
    setShowPropertyModal(false);
  };

  // Unit Modal Handlers
  const openAddUnitModal = (defaultPropId?: string) => {
    const chosenPropId =
      defaultPropId ||
      (selectedPropertyId !== 'ALL' ? selectedPropertyId : properties[0]?.property_id) ||
      '';
    setEditingUnitId(null);
    setParentPropertyId(chosenPropId);
    setUnitName('');
    setUnitType('2BHK');
    setFloor('Ground Floor');
    setEbRrNumber('');
    setWaterRrNumber('');
    setWaterRrNumber2('');
    setStatus('VACANT');
    setUnitFormError(null);
    setShowUnitModal(true);
  };

  const openEditUnitModal = (unit: Unit) => {
    setEditingUnitId(unit.unit_id);
    setParentPropertyId(unit.property_id);
    setUnitName(unit.unit_name);
    setUnitType(unit.unit_type);
    setFloor(unit.floor);
    setEbRrNumber(unit.eb_rr_number);
    setWaterRrNumber(unit.water_rr_number);
    setWaterRrNumber2(unit.water_rr_number2 || '');
    setStatus(unit.status);
    setUnitFormError(null);
    setShowUnitModal(true);
  };

  const handleUnitSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUnitFormError(null);

    if (
      !parentPropertyId ||
      !unitName.trim() ||
      !unitType.trim() ||
      !floor.trim() ||
      !ebRrNumber.trim() ||
      !waterRrNumber.trim()
    ) {
      setUnitFormError(
        'Parent House, Unit Name, Unit Type, Floor, EB RR Number, and Water RR Number are required.'
      );
      return;
    }

    const existing = editingUnitId
      ? units.find((u) => u.unit_id === editingUnitId)
      : undefined;

    const nextUnit: Unit = {
      unit_id: existing?.unit_id || `UNIT-${Date.now().toString().slice(-6)}`,
      property_id: parentPropertyId,
      unit_name: unitName.trim(),
      unit_type: unitType.trim(),
      floor: floor.trim(),
      eb_rr_number: ebRrNumber.trim(),
      water_rr_number: waterRrNumber.trim(),
      water_rr_number2: waterRrNumber2.trim() || undefined,
      status,
      current_tenant_id: status === 'VACANT' ? null : existing?.current_tenant_id || null,
      last_water_reading_1: existing?.last_water_reading_1 ?? 0,
      last_water_reading_2: existing?.last_water_reading_2 ?? 0,
    };

    onSaveUnit(nextUnit, !existing);
    setShowUnitModal(false);
  };

  const copyValue = async (val: string, key: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="min-h-full">
      <MobileShellHeader
        title={activeTab === 'properties' ? 'Properties & Houses' : 'Units & RR Numbers'}
        subtitle={`${properties.length} Houses · ${units.length} Units`}
        onBack={onBack}
        rightSlot={
          <button
            type="button"
            onClick={() =>
              activeTab === 'properties'
                ? openAddPropertyModal()
                : openAddUnitModal()
            }
            disabled={activeTab === 'units' && properties.length === 0}
            className="inline-flex items-center gap-1 rounded-xl bg-white text-[#3E8E41] px-3 py-1.5 text-xs font-bold shadow-2xs hover:bg-emerald-50 disabled:opacity-50 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{activeTab === 'properties' ? 'Add House' : 'Add Unit'}</span>
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-white/15">
          <button
            type="button"
            onClick={() => setActiveTab('properties')}
            className={`py-2 px-3 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
              activeTab === 'properties'
                ? 'bg-white text-[#3E8E41] shadow-xs'
                : 'text-white/90 hover:bg-white/10'
            }`}
          >
            Houses ({properties.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('units')}
            className={`py-2 px-3 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
              activeTab === 'units'
                ? 'bg-white text-[#3E8E41] shadow-xs'
                : 'text-white/90 hover:bg-white/10'
            }`}
          >
            Units ({units.length})
          </button>
        </div>
      </MobileShellHeader>

      {/* Curved White Lower Sheet */}
      <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[calc(100vh-150px)] space-y-4">
        {/* House Filter + Quick Add Row */}
        <div className="flex items-center justify-between gap-2">
          <select
            aria-label="Filter and Group by House"
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

          <button
            type="button"
            onClick={openAddPropertyModal}
            className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] hover:bg-gray-50 cursor-pointer min-h-[40px] shrink-0"
          >
            <Building2 className="w-3.5 h-3.5 text-[#489E44]" />
            <span>+ House</span>
          </button>
        </div>

        {activeTab === 'properties' ? (
          <div className="space-y-3.5">
            {visibleProperties.map((property) => {
              const propUnits = units.filter((u) => u.property_id === property.property_id);
              const occCount = propUnits.filter((u) => u.status === 'OCCUPIED').length;

              return (
                <article
                  key={property.property_id}
                  className="rounded-2xl border border-gray-100 bg-white p-4 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h2 className="text-base font-bold text-[#0f172a]">
                          {property.property_name}
                        </h2>
                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-[#3E8E41] font-mono">
                          {property.utility_provider}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                        <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="truncate">{property.address}</span>
                      </div>
                    </div>

                    <span className="rounded-xl bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-[#0f172a] font-mono shrink-0">
                      {occCount}/{propUnits.length} Occ
                    </span>
                  </div>

                  <div className="rounded-xl bg-gray-50 px-3 py-2 flex items-center justify-between text-xs">
                    <span className="text-gray-500">
                      {property.total_floors} Floors · Common EB RR
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyValue(property.common_eb_rr_number, `${property.property_id}-cmn`)
                      }
                      className="inline-flex items-center gap-1 font-mono font-semibold text-[#0f172a] hover:text-[#489E44] cursor-pointer"
                    >
                      <span>{property.common_eb_rr_number}</span>
                      {copiedKey === `${property.property_id}-cmn` ? (
                        <Check className="w-3.5 h-3.5 text-[#489E44]" />
                      ) : (
                        <Copy className="w-3 h-3 text-gray-400" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        onChangeSelectedPropertyId(property.property_id);
                        setActiveTab('units');
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#489E44] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer"
                    >
                      <Home className="w-3.5 h-3.5" />
                      <span>View {propUnits.length} Units</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditPropertyModal(property)}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] hover:bg-gray-50 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-[#489E44]" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      disabled={propUnits.length > 0}
                      onClick={() =>
                        setPendingDelete({
                          type: 'property',
                          id: property.property_id,
                          name: property.property_name,
                        })
                      }
                      title={
                        propUnits.length > 0
                          ? 'Delete child units first'
                          : 'Delete House'
                      }
                      className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-500 hover:text-rose-600 disabled:opacity-40 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="space-y-5">
            {visibleProperties.map((property) => {
              const propUnits = units.filter(
                (u) => u.property_id === property.property_id
              );
              const floorsMap = new Map<string, Unit[]>();
              propUnits.forEach((u) => {
                const list = floorsMap.get(u.floor) || [];
                list.push(u);
                floorsMap.set(u.floor, list);
              });
              const sortedFloors = Array.from(floorsMap.entries()).sort(
                ([a], [b]) => getFloorSortRank(a) - getFloorSortRank(b)
              );

              return (
                <section key={property.property_id} className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-4 h-4 text-[#489E44] shrink-0" />
                      <h2 className="text-sm font-bold text-[#0f172a] truncate">
                        {property.property_name}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => openAddUnitModal(property.property_id)}
                      className="text-xs font-bold text-[#489E44] hover:underline cursor-pointer shrink-0"
                    >
                      + Add Unit
                    </button>
                  </div>

                  {sortedFloors.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 p-5 text-center text-xs text-gray-500">
                      No units added to {property.property_name} yet.
                    </div>
                  ) : (
                    sortedFloors.map(([floorName, floorUnits]) => (
                      <div key={floorName} className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-1">
                          {floorName}
                        </div>

                        {floorUnits.map((unit) => {
                          const tenant = unit.current_tenant_id
                            ? tenants.find(
                                (t) => t.id === unit.current_tenant_id && t.is_active
                              )
                            : undefined;

                          return (
                            <article
                              key={unit.unit_id}
                              className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-xs space-y-3"
                            >
                              <div
                                className={`absolute top-3 -right-8 w-28 rotate-45 text-center text-[9px] font-extrabold tracking-wider py-0.5 text-white shadow-2xs pointer-events-none ${
                                  unit.status === 'OCCUPIED'
                                    ? 'bg-[#489E44]'
                                    : 'bg-amber-500'
                                }`}
                              >
                                {unit.status}
                              </div>

                              <div className="pr-10">
                                <div className="text-[11px] font-semibold text-gray-500">
                                  {unit.floor} · {unit.unit_type}
                                </div>
                                <h3 className="text-base font-bold text-[#0f172a]">
                                  {unit.unit_name}
                                </h3>
                                {tenant && (
                                  <div className="text-xs text-[#3E8E41] font-semibold mt-0.5 flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>
                                      {tenant.full_name} ({tenant.lease_type})
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className="rounded-xl bg-gray-50 p-3 space-y-1.5 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-gray-500">
                                    EB RR ({property.utility_provider})
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      copyValue(unit.eb_rr_number, `${unit.unit_id}-eb`)
                                    }
                                    className="inline-flex items-center gap-1 font-mono font-semibold text-[#0f172a] hover:text-[#489E44] cursor-pointer"
                                  >
                                    <span>{unit.eb_rr_number}</span>
                                    {copiedKey === `${unit.unit_id}-eb` ? (
                                      <Check className="w-3.5 h-3.5 text-[#489E44]" />
                                    ) : (
                                      <Copy className="w-3 h-3 text-gray-400" />
                                    )}
                                  </button>
                                </div>

                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-gray-500">Water RR #1</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      copyValue(
                                        unit.water_rr_number,
                                        `${unit.unit_id}-w1`
                                      )
                                    }
                                    className="inline-flex items-center gap-1 font-mono font-semibold text-[#0f172a] hover:text-[#489E44] cursor-pointer"
                                  >
                                    <span>{unit.water_rr_number}</span>
                                    {copiedKey === `${unit.unit_id}-w1` ? (
                                      <Check className="w-3.5 h-3.5 text-[#489E44]" />
                                    ) : (
                                      <Copy className="w-3 h-3 text-gray-400" />
                                    )}
                                  </button>
                                </div>

                                {unit.water_rr_number2 && (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-gray-500">Water RR #2</span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        copyValue(
                                          unit.water_rr_number2!,
                                          `${unit.unit_id}-w2`
                                        )
                                      }
                                      className="inline-flex items-center gap-1 font-mono font-semibold text-[#0f172a] hover:text-[#489E44] cursor-pointer"
                                    >
                                      <span>{unit.water_rr_number2}</span>
                                      {copiedKey === `${unit.unit_id}-w2` ? (
                                        <Check className="w-3.5 h-3.5 text-[#489E44]" />
                                      ) : (
                                        <Copy className="w-3 h-3 text-gray-400" />
                                      )}
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditUnitModal(unit)}
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] hover:bg-gray-50 cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-[#489E44]" />
                                  <span>Edit Unit</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={unit.status === 'OCCUPIED'}
                                  onClick={() =>
                                    setPendingDelete({
                                      type: 'unit',
                                      id: unit.unit_id,
                                      name: `${property.property_name} — ${unit.unit_name}`,
                                    })
                                  }
                                  className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white p-2 text-gray-500 hover:text-rose-600 disabled:opacity-40 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ))
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal 1: Add / Edit House (Parent Property) */}
      {showPropertyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-[#0f172a]">
                {editingPropertyId ? 'Edit House (Property)' : 'Add New House (Property)'}
              </h3>
              <button
                type="button"
                onClick={() => setShowPropertyModal(false)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"
                aria-label="Close house form"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePropertySubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Property / House Name *
                </label>
                <input
                  type="text"
                  required
                  value={propertyName}
                  onChange={(e) => setPropertyName(e.target.value)}
                  placeholder="e.g., BglrNewHouse"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, Area, City, PIN"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Total Floors *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    required
                    value={totalFloors}
                    onChange={(e) => setTotalFloors(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Utility Board *
                  </label>
                  <select
                    value={utilityProvider}
                    onChange={(e) =>
                      setUtilityProvider(e.target.value as UtilityProvider)
                    }
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                  >
                    <option value="BESCOM">BESCOM</option>
                    <option value="TNEB">TNEB</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Common EB RR *
                </label>
                <input
                  type="text"
                  required
                  value={commonEbRrNumber}
                  onChange={(e) => setCommonEbRrNumber(e.target.value)}
                  placeholder="e.g., E4EH-88200-CMN"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
                />
              </div>

              {propertyFormError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {propertyFormError}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPropertyModal(false)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#489E44] px-5 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer min-h-[40px]"
                >
                  {editingPropertyId ? 'Save Changes' : 'Create House'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Add / Edit Child Unit under a House */}
      {showUnitModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-[#0f172a]">
                {editingUnitId ? 'Edit Unit' : 'Add Unit under House'}
              </h3>
              <button
                type="button"
                onClick={() => setShowUnitModal(false)}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"
                aria-label="Close unit form"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUnitSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Parent House (Property) *
                </label>
                <select
                  value={parentPropertyId}
                  onChange={(e) => setParentPropertyId(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-[#0f172a] min-h-[42px]"
                >
                  {properties.map((p) => (
                    <option key={p.property_id} value={p.property_id}>
                      {p.property_name} ({p.utility_provider})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Unit Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={unitName}
                    onChange={(e) => setUnitName(e.target.value)}
                    placeholder="e.g., 3F-1RK-A"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Unit Type *
                  </label>
                  <select
                    value={unitType}
                    onChange={(e) => setUnitType(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                  >
                    <option value="2BHK">2BHK</option>
                    <option value="1BHK">1BHK</option>
                    <option value="1RK">1RK</option>
                    <option value="3BHK">3BHK</option>
                    <option value="Studio">Studio</option>
                    <option value="Shop">Shop / Commercial</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Floor *
                  </label>
                  <input
                    type="text"
                    required
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    placeholder="e.g., Ground Floor"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Tenancy Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as UnitStatus)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0f172a] min-h-[42px]"
                  >
                    <option value="VACANT">VACANT</option>
                    <option value="OCCUPIED">OCCUPIED</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Unit EB RR Number *
                </label>
                <input
                  type="text"
                  required
                  value={ebRrNumber}
                  onChange={(e) => setEbRrNumber(e.target.value)}
                  placeholder="e.g., E4EH-88219"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Water RR #1 *
                  </label>
                  <input
                    type="text"
                    required
                    value={waterRrNumber}
                    onChange={(e) => setWaterRrNumber(e.target.value)}
                    placeholder="BW-10489-A"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Water RR #2
                  </label>
                  <input
                    type="text"
                    value={waterRrNumber2}
                    onChange={(e) => setWaterRrNumber2(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-[#0f172a] min-h-[42px]"
                  />
                </div>
              </div>

              {unitFormError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {unitFormError}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowUnitModal(false)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#489E44] px-5 py-2 text-xs font-semibold text-white hover:bg-[#3E8E41] cursor-pointer min-h-[40px]"
                >
                  {editingUnitId ? 'Save Changes' : 'Add Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-[95vw] max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-[#0f172a]">
              Confirm {pendingDelete.type === 'property' ? 'House' : 'Unit'} Deletion
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Permanently remove <strong className="text-[#0f172a]">{pendingDelete.name}</strong>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pendingDelete.type === 'property') {
                    onDeleteProperty(pendingDelete.id);
                  } else {
                    onDeleteUnit(pendingDelete.id);
                  }
                  setPendingDelete(null);
                }}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
