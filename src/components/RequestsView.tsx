import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Droplets,
  Paintbrush,
  Plus,
  Search,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  MaintenanceRequest,
  PropertyHouse,
  RequestCategory,
  RequestStatus,
  TenantRecord,
  Unit,
} from '../types/estate';

interface RequestsViewProps {
  properties: PropertyHouse[];
  units: Unit[];
  tenants: TenantRecord[];
  requests: MaintenanceRequest[];
  selectedPropertyId: string;
  onChangeSelectedPropertyId: (propertyId: string) => void;
  onSaveRequest: (request: MaintenanceRequest, isNew: boolean) => void;
}

const CATEGORIES: RequestCategory[] = [
  'Plumbing',
  'Electrical',
  'Painting',
  'Other',
];

const STATUSES: RequestStatus[] = ['Open', 'In Progress', 'Resolved'];

function getStatusClasses(status: RequestStatus): string {
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

function CategoryBadgeIcon({ category }: { category: RequestCategory }) {
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

export const RequestsView: React.FC<RequestsViewProps> = ({
  properties,
  units,
  tenants,
  requests,
  selectedPropertyId,
  onChangeSelectedPropertyId,
  onSaveRequest,
}) => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | RequestStatus>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | RequestCategory>(
    'ALL'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // New Request Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formPropertyId, setFormPropertyId] = useState(
    properties[0]?.property_id || ''
  );
  const [formUnitId, setFormUnitId] = useState('');
  const [formCategory, setFormCategory] = useState<RequestCategory>('Plumbing');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Update / Resolve Modal
  const [editingRequest, setEditingRequest] =
    useState<MaintenanceRequest | null>(null);
  const [editStatus, setEditStatus] = useState<RequestStatus>('Open');
  const [editNote, setEditNote] = useState('');

  const scopedRequests = useMemo(() => {
    return selectedPropertyId === 'ALL'
      ? requests
      : requests.filter((r) => r.property_id === selectedPropertyId);
  }, [requests, selectedPropertyId]);

  const counts = useMemo(() => {
    return {
      total: scopedRequests.length,
      open: scopedRequests.filter((r) => r.status === 'Open').length,
      inProgress: scopedRequests.filter((r) => r.status === 'In Progress').length,
      resolved: scopedRequests.filter((r) => r.status === 'Resolved').length,
    };
  }, [scopedRequests]);

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedRequests
      .filter((r) => {
        if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
        if (categoryFilter !== 'ALL' && r.category !== categoryFilter) {
          return false;
        }
        if (!q) return true;
        return (
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.unit_name.toLowerCase().includes(q) ||
          r.property_name.toLowerCase().includes(q) ||
          r.tenant_name.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [scopedRequests, statusFilter, categoryFilter, searchQuery]);

  const openCreateModal = () => {
    const initialPropId =
      selectedPropertyId !== 'ALL'
        ? selectedPropertyId
        : properties[0]?.property_id || '';
    const firstUnit = units.find((u) => u.property_id === initialPropId);
    setFormPropertyId(initialPropId);
    setFormUnitId(firstUnit?.unit_id || '');
    setFormCategory('Plumbing');
    setFormTitle('');
    setFormDescription('');
    setFormError(null);
    setShowCreateModal(true);
  };

  const formUnits = useMemo(
    () => units.filter((u) => u.property_id === formPropertyId),
    [units, formPropertyId]
  );

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formPropertyId || !formUnitId) {
      setFormError('Select a property and unit.');
      return;
    }
    if (!formTitle.trim() || !formDescription.trim()) {
      setFormError('Enter both an issue title and description.');
      return;
    }

    const prop = properties.find((p) => p.property_id === formPropertyId);
    const unit = units.find((u) => u.unit_id === formUnitId);
    const tenant = unit?.current_tenant_id
      ? tenants.find((t) => t.id === unit.current_tenant_id)
      : undefined;
    const nowIso = new Date().toISOString();

    const newReq: MaintenanceRequest = {
      id: `REQ-${Date.now().toString().slice(-6)}`,
      property_id: formPropertyId,
      property_name: prop?.property_name || formPropertyId,
      unit_id: formUnitId,
      unit_name: unit?.unit_name || formUnitId,
      tenant_id: tenant?.id || 'OWNER-LOG',
      tenant_name: tenant?.full_name || 'Vacant / Owner Inspection',
      category: formCategory,
      title: formTitle.trim(),
      description: formDescription.trim(),
      status: 'Open',
      reported_by: 'Owner',
      created_at: nowIso,
      updated_at: nowIso,
      resolved_at: null,
      resolution_note: '',
    };

    onSaveRequest(newReq, true);
    setShowCreateModal(false);
  };

  const openUpdateModal = (req: MaintenanceRequest) => {
    setEditingRequest(req);
    setEditStatus(req.status);
    setEditNote(req.resolution_note || '');
  };

  const handleQuickStatus = (req: MaintenanceRequest, nextStatus: RequestStatus) => {
    const nowIso = new Date().toISOString();
    onSaveRequest(
      {
        ...req,
        status: nextStatus,
        updated_at: nowIso,
        resolved_at: nextStatus === 'Resolved' ? req.resolved_at || nowIso : null,
      },
      false
    );
  };

  const handleSaveUpdateModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRequest) return;
    const nowIso = new Date().toISOString();
    onSaveRequest(
      {
        ...editingRequest,
        status: editStatus,
        resolution_note: editNote.trim(),
        updated_at: nowIso,
        resolved_at:
          editStatus === 'Resolved' ? editingRequest.resolved_at || nowIso : null,
      },
      false
    );
    setEditingRequest(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#2563eb]">
            <Wrench className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#0f172a]">
              Maintenance &amp; Tenant Requests Tracker
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Synced live with the <span className="font-mono font-semibold">Requests</span>{' '}
              tab in Google Sheets
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer min-h-[42px] shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Log Repair Request</span>
        </button>
      </section>

      {/* KPI Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <div className="text-xs font-semibold text-slate-500">Total Requests</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#0f172a]">
            {counts.total}
          </div>
        </div>
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <div className="text-xs font-semibold text-amber-700">Open Tickets</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-amber-600">
            {counts.open}
          </div>
        </div>
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <div className="text-xs font-semibold text-indigo-700">In Progress</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-indigo-600">
            {counts.inProgress}
          </div>
        </div>
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <div className="text-xs font-semibold text-emerald-700">Resolved</div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-600">
            {counts.resolved}
          </div>
        </div>
      </section>

      {/* Filter Bar */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter Requests by Property"
            value={selectedPropertyId}
            onChange={(e) => onChangeSelectedPropertyId(e.target.value)}
            className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[40px]"
          >
            <option value="ALL">All Houses ({properties.length})</option>
            {properties.map((p) => (
              <option key={p.property_id} value={p.property_id}>
                {p.property_name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Requests by Category"
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as 'ALL' | RequestCategory)
            }
            className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[40px]"
          >
            <option value="ALL">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 border border-[#e2e8f0]">
            {(['ALL', ...STATUSES] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer min-h-[32px] ${
                  statusFilter === st
                    ? 'bg-white text-[#0f172a] shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search unit, tenant, issue..."
            className="w-full rounded-lg border border-[#e2e8f0] bg-white pl-9 pr-3 py-2 text-xs sm:text-sm text-[#0f172a] min-h-[40px]"
          />
        </div>
      </section>

      {/* Requests Grid */}
      {filteredRequests.length === 0 ? (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-10 text-center text-xs text-slate-500">
          No maintenance requests match the active filters.
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredRequests.map((req) => (
            <article
              key={req.id}
              className="rounded-xl border border-[#e2e8f0] bg-white p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md border border-[#e2e8f0] bg-[#f8f9ff] px-2 py-0.5 text-[11px] font-semibold text-[#0f172a]">
                      <CategoryBadgeIcon category={req.category} />
                      <span>{req.category}</span>
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {req.id}
                    </span>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold shrink-0 ${getStatusClasses(
                      req.status
                    )}`}
                  >
                    {req.status === 'Resolved' ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <Clock className="w-3 h-3" />
                    )}
                    {req.status}
                  </span>
                </div>

                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#0f172a]">
                    {req.title}
                  </h3>
                  <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-[#2563eb]">
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {req.property_name} · {req.unit_name}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Resident: {req.tenant_name} · Source: {req.reported_by}
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  {req.description}
                </p>

                {req.resolution_note && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[11px] text-emerald-900">
                    <strong>Resolution Note:</strong> {req.resolution_note}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>
                    Logged {new Date(req.created_at).toLocaleDateString('en-IN')}
                  </span>
                  {req.resolved_at && (
                    <span className="text-emerald-700 font-semibold">
                      Resolved {new Date(req.resolved_at).toLocaleDateString('en-IN')}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {req.status === 'Open' && (
                    <button
                      type="button"
                      onClick={() => handleQuickStatus(req, 'In Progress')}
                      className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 cursor-pointer min-h-[38px]"
                    >
                      Start Work
                    </button>
                  )}
                  {req.status !== 'Resolved' && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingRequest(req);
                        setEditStatus('Resolved');
                        setEditNote(req.resolution_note || '');
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-[#10b981] px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 cursor-pointer min-h-[38px]"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Resolve</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openUpdateModal(req)}
                    className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] hover:bg-slate-50 cursor-pointer min-h-[38px]"
                  >
                    Edit / Note
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* Log New Request Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-[#0f172a]">
                Log Maintenance Request
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Property / House *
                  </label>
                  <select
                    value={formPropertyId}
                    onChange={(e) => {
                      const nextProp = e.target.value;
                      setFormPropertyId(nextProp);
                      const first = units.find((u) => u.property_id === nextProp);
                      setFormUnitId(first?.unit_id || '');
                    }}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm font-semibold text-[#0f172a] min-h-[44px]"
                  >
                    {properties.map((p) => (
                      <option key={p.property_id} value={p.property_id}>
                        {p.property_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Unit *
                  </label>
                  <select
                    value={formUnitId}
                    onChange={(e) => setFormUnitId(e.target.value)}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm font-semibold text-[#0f172a] min-h-[44px]"
                  >
                    {formUnits.map((u) => (
                      <option key={u.unit_id} value={u.unit_id}>
                        {u.unit_name} ({u.floor})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Category *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setFormCategory(cat)}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold cursor-pointer min-h-[40px] ${
                        formCategory === cat
                          ? 'border-[#2563eb] bg-blue-50 text-[#0f172a]'
                          : 'border-[#e2e8f0] bg-white text-slate-600'
                      }`}
                    >
                      <CategoryBadgeIcon category={cat} />
                      <span>{cat}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g., Overhead tank float valve replacement"
                  className="w-full rounded-lg border border-[#e2e8f0] px-3.5 py-2.5 text-sm text-[#0f172a] min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description *
                </label>
                <textarea
                  rows={3}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Repair scope, technician notes, or tenant report details..."
                  className="w-full rounded-lg border border-[#e2e8f0] px-3.5 py-2.5 text-sm text-[#0f172a]"
                />
              </div>

              {formError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#2563eb] px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer min-h-[40px]"
                >
                  Save Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Status & Resolution Note Modal */}
      {editingRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-2 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="font-mono text-xs text-[#2563eb] font-semibold">
                  {editingRequest.id} · {editingRequest.property_name} ·{' '}
                  {editingRequest.unit_name}
                </div>
                <h3 className="text-base font-bold text-[#0f172a] mt-0.5">
                  {editingRequest.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingRequest(null)}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUpdateModal} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Status
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setEditStatus(st)}
                      className={`rounded-lg border px-2.5 py-2 text-xs font-semibold cursor-pointer min-h-[40px] ${
                        editStatus === st
                          ? 'border-[#2563eb] bg-blue-50 text-[#0f172a]'
                          : 'border-[#e2e8f0] bg-white text-slate-600'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Resolution / Technician Note
                </label>
                <textarea
                  rows={3}
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="e.g., Replaced washer & tested line pressure with plumber."
                  className="w-full rounded-lg border border-[#e2e8f0] px-3.5 py-2.5 text-sm text-[#0f172a]"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingRequest(null)}
                  className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#2563eb] px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer min-h-[40px]"
                >
                  Save Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
