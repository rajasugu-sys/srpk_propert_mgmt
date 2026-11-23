import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  FileDown,
  IndianRupee,
  Landmark,
  LayoutGrid,
  MessageSquare,
  Paintbrush,
  Pencil,
  Plus,
  Receipt,
  Search,
  Share2,
  ShieldCheck,
  Table2,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  ExpenseCategory,
  ExpenseRecord,
  InvoiceRecord,
  PropertyHouse,
} from '../types/estate';
import {
  formatBillingMonthLabel,
  formatINR,
  formatWhatsAppPnLReport,
  normalizeWhatsAppDigits,
} from '../utils/billingEngine';
import { exportExpensesSummaryPdf } from '../utils/expensePdfExport';

const EXPENSES_VIEW_MODE_KEY = 'srpk_expenses_view_mode_v1';
type ExpenseViewMode = 'card' | 'table';

interface ExpensesViewProps {
  properties: PropertyHouse[];
  invoices: InvoiceRecord[];
  expenses: ExpenseRecord[];
  billingMonth: string;
  ownerWhatsappPhone: string;
  onBack: () => void;
  onChangeBillingMonth: (month: string) => void;
  onOpenAddExpenses: () => void;
  onUpdateExpense: (expense: ExpenseRecord) => void;
  onDeleteExpense: (expenseId: string) => void;
  isReadOnly?: boolean;
  senderSignature?: string;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Plumbing / Repairs',
  'Painting & Maintenance',
  'Property Tax & Municipal',
  'Common Area EB / Water',
  'Cleaning & Security',
  'Other',
];

function getCategoryVisual(category: ExpenseCategory): {
  icon: React.ComponentType<{ className?: string }>;
  badgeClass: string;
} {
  switch (category) {
    case 'Plumbing / Repairs':
      return { icon: Wrench, badgeClass: 'bg-sky-50 text-sky-700' };
    case 'Painting & Maintenance':
      return { icon: Paintbrush, badgeClass: 'bg-amber-50 text-amber-700' };
    case 'Property Tax & Municipal':
      return { icon: Landmark, badgeClass: 'bg-purple-50 text-purple-700' };
    case 'Common Area EB / Water':
      return { icon: Zap, badgeClass: 'bg-yellow-50 text-amber-700' };
    case 'Cleaning & Security':
      return { icon: ShieldCheck, badgeClass: 'bg-emerald-50 text-[#3E8E41]' };
    case 'Other':
    default:
      return { icon: Receipt, badgeClass: 'bg-gray-100 text-gray-700' };
  }
}

function getHousePillClasses(houseId: string, index: number): string {
  if (houseId === 'OTHER') return 'bg-amber-50 text-amber-800 border-amber-200';
  const palettes = [
    'bg-emerald-50 text-[#3E8E41] border-emerald-200',
    'bg-sky-50 text-sky-800 border-sky-200',
    'bg-indigo-50 text-indigo-800 border-indigo-200',
    'bg-teal-50 text-teal-800 border-teal-200',
  ];
  return palettes[index % palettes.length];
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({
  properties,
  invoices,
  expenses,
  billingMonth,
  ownerWhatsappPhone,
  onBack,
  onChangeBillingMonth,
  onOpenAddExpenses,
  onUpdateExpense,
  onDeleteExpense,
  isReadOnly = false,
  senderSignature = 'SRKP Rental Management',
}) => {
  const [houseFilter, setHouseFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<ExpenseViewMode>(() => {
    try {
      const saved = localStorage.getItem(EXPENSES_VIEW_MODE_KEY);
      return saved === 'table' ? 'table' : 'card';
    } catch {
      return 'card';
    }
  });

  const handleChangeViewMode = (mode: ExpenseViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(EXPENSES_VIEW_MODE_KEY, mode);
    } catch {
      // Ignore storage write issues
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  // Edit expense modal state
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);
  const [editHouseId, setEditHouseId] = useState<string>('OTHER');
  const [editDate, setEditDate] = useState<string>('');
  const [editCategory, setEditCategory] = useState<ExpenseCategory>('Plumbing / Repairs');
  const [editDescription, setEditDescription] = useState<string>('');
  const [editAmount, setEditAmount] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);

  const monthOptions = useMemo(() => {
    const set = new Set<string>(['2026-12', '2026-11', '2026-10', billingMonth]);
    invoices.forEach((inv) => {
      if (inv.billing_month) set.add(inv.billing_month);
    });
    expenses.forEach((exp) => {
      if (exp.month) set.add(exp.month);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [invoices, expenses, billingMonth]);

  const monthInvoices = useMemo(
    () => invoices.filter((inv) => inv.billing_month === billingMonth),
    [invoices, billingMonth]
  );

  const monthExpenses = useMemo(
    () =>
      expenses
        .filter((exp) => exp.month === billingMonth)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [expenses, billingMonth]
  );

  // Summary KPIs dynamically scoped to selected houseFilter
  const scopedSummary = useMemo(() => {
    const filteredInv =
      houseFilter === 'ALL'
        ? monthInvoices
        : houseFilter === 'OTHER'
          ? []
          : monthInvoices.filter((inv) => inv.property_id === houseFilter);

    const totalIncome = filteredInv.reduce(
      (sum, inv) => sum + (inv.total_payable_to_owner || 0),
      0
    );
    const totalCollected = filteredInv.reduce(
      (sum, inv) => sum + (inv.amount_paid || 0),
      0
    );

    const filteredExp =
      houseFilter === 'ALL'
        ? monthExpenses
        : monthExpenses.filter((exp) => exp.house_id === houseFilter);

    const totalExpense = filteredExp.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    const netBalance = totalIncome - totalExpense;

    return {
      totalIncome,
      totalCollected,
      totalExpense,
      netBalance,
      expenseCount: filteredExp.length,
    };
  }, [monthInvoices, monthExpenses, houseFilter]);

  // House-wise expense breakdown across all houses + Other for selected month
  const houseBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    monthExpenses.forEach((exp) => {
      map.set(exp.house_id, (map.get(exp.house_id) || 0) + exp.amount);
    });
    const houseRows = properties.map((p) => ({
      houseId: p.property_id,
      houseName: p.property_name,
      amount: map.get(p.property_id) || 0,
    }));
    const otherAmount = map.get('OTHER') || 0;
    return { houseRows, otherAmount };
  }, [monthExpenses, properties]);

  // Overall month P&L for Share Report modal
  const fullMonthPnL = useMemo(() => {
    const totalIncome = monthInvoices.reduce(
      (sum, inv) => sum + (inv.total_payable_to_owner || 0),
      0
    );
    const totalExpenses = monthExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
    return {
      month: billingMonth,
      totalIncome,
      houseExpenses: houseBreakdown.houseRows.map((h) => ({
        houseName: h.houseName,
        amount: h.amount,
      })),
      otherExpenses: houseBreakdown.otherAmount,
      totalExpenses,
      netBalance: totalIncome - totalExpenses,
    };
  }, [monthInvoices, monthExpenses, billingMonth, houseBreakdown]);

  const pnlReportText = useMemo(
    () => formatWhatsAppPnLReport({ ...fullMonthPnL, senderSignature }),
    [fullMonthPnL, senderSignature]
  );

  // Filtered & searched transactions list
  const visibleTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return monthExpenses.filter((exp) => {
      if (houseFilter !== 'ALL' && exp.house_id !== houseFilter) return false;
      if (!q) return true;
      return (
        exp.description.toLowerCase().includes(q) ||
        exp.category.toLowerCase().includes(q) ||
        exp.house_name.toLowerCase().includes(q)
      );
    });
  }, [monthExpenses, houseFilter, searchQuery]);

  const openEditModal = (exp: ExpenseRecord) => {
    setEditingExpense(exp);
    setEditHouseId(exp.house_id);
    setEditDate(exp.date);
    setEditCategory(exp.category);
    setEditDescription(exp.description);
    setEditAmount(String(exp.amount));
    setEditError(null);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense) return;
    setEditError(null);

    const desc = editDescription.trim();
    const amt = Number(editAmount);
    if (!desc) {
      setEditError('Please enter a description.');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setEditError('Enter a valid expense amount greater than ₹0.');
      return;
    }

    const chosenHouse = properties.find((p) => p.property_id === editHouseId);
    const nextDate = editDate || editingExpense.date;
    const nextMonth = nextDate.length >= 7 ? nextDate.slice(0, 7) : editingExpense.month;

    onUpdateExpense({
      ...editingExpense,
      house_id: chosenHouse ? chosenHouse.property_id : 'OTHER',
      house_name: chosenHouse ? chosenHouse.property_name : 'General / Other',
      date: nextDate,
      month: nextMonth,
      category: editCategory,
      description: desc,
      amount: Math.round(amt),
    });

    setEditingExpense(null);
  };

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(pnlReportText);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const isNegativeNet = scopedSummary.netBalance < 0;

  return (
    <div>
      {/* 1. Emerald Green Top Header */}
      <header className="bg-gradient-to-b from-[#489E44] to-[#3E8E41] text-white px-4 pt-4 pb-9">
        {/* Top Row: Back Arrow | Centered Title & Dynamic Month Subtitle | Share Report Button */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer"
            aria-label="Back to Home"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <h1 className="text-base font-bold tracking-tight text-white">
              Expenses
            </h1>
            <div className="flex items-center justify-center gap-1 mt-0.5">
              <span className="text-[11px] text-emerald-50/90">
                Financial Summary ·
              </span>
              <select
                aria-label="Select Financial Summary Month"
                value={billingMonth}
                onChange={(e) => onChangeBillingMonth(e.target.value)}
                className="bg-white/15 border border-white/25 rounded-lg px-1.5 py-0.5 text-[11px] font-bold text-white cursor-pointer"
              >
                {monthOptions.map((m) => (
                  <option key={m} value={m} className="text-slate-900">
                    {formatBillingMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            className="inline-flex items-center gap-1 rounded-xl bg-white/15 border border-white/25 px-2.5 py-2 text-[11px] font-bold text-white hover:bg-white/25 transition-colors cursor-pointer shrink-0 min-h-[40px]"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share Report</span>
          </button>
        </div>

        {/* 3 Stacked White Summary Cards */}
        <div className="mt-4 space-y-2.5">
          {/* Card 1: Total Income */}
          <div className="rounded-2xl bg-white p-3.5 shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#489E44]">
                <IndianRupee className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-gray-500">Total Income</div>
                <div className="text-[11px] text-gray-400 truncate">
                  {houseFilter === 'OTHER'
                    ? 'General filter (no rental income)'
                    : `Collected: ${formatINR(scopedSummary.totalCollected)}`}
                </div>
              </div>
            </div>
            <div className="text-lg font-extrabold text-[#0f172a] font-mono tabular-nums shrink-0">
              {formatINR(scopedSummary.totalIncome)}
            </div>
          </div>

          {/* Card 2: Total Expense */}
          <div className="rounded-2xl bg-white p-3.5 shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-gray-500">Total Expense</div>
                <div className="text-[11px] text-gray-400 truncate">
                  {scopedSummary.expenseCount} recorded item
                  {scopedSummary.expenseCount === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <div className="text-lg font-extrabold text-[#0f172a] font-mono tabular-nums shrink-0">
              {formatINR(scopedSummary.totalExpense)}
            </div>
          </div>

          {/* Card 3: Net Balance (Highlighted Green, or Red if Expense > Income) */}
          <div
            className={`rounded-2xl p-3.5 shadow-sm flex items-center justify-between gap-3 border ${
              isNegativeNet
                ? 'bg-rose-50 border-rose-200'
                : 'bg-emerald-50 border-emerald-200'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  isNegativeNet
                    ? 'bg-rose-100 text-rose-600'
                    : 'bg-[#489E44] text-white'
                }`}
              >
                {isNegativeNet ? (
                  <TrendingDown className="w-5 h-5" />
                ) : (
                  <TrendingUp className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0">
                <div
                  className={`text-xs font-bold ${
                    isNegativeNet ? 'text-rose-700' : 'text-[#3E8E41]'
                  }`}
                >
                  Net Balance
                </div>
                <div
                  className={`text-[11px] truncate ${
                    isNegativeNet ? 'text-rose-600' : 'text-emerald-700'
                  }`}
                >
                  {isNegativeNet ? 'Expenses exceed income' : 'Income minus expenses'}
                </div>
              </div>
            </div>
            <div
              className={`text-xl font-extrabold font-mono tabular-nums shrink-0 ${
                isNegativeNet ? 'text-rose-700' : 'text-[#3E8E41]'
              }`}
            >
              {isNegativeNet ? '-' : ''}
              {formatINR(Math.abs(scopedSummary.netBalance))}
            </div>
          </div>
        </div>
      </header>

      {/* 2. Curved White Lower Sheet */}
      <section className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[55vh] space-y-4">
        {/* Primary Action Row */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#0f172a]">Expense Ledger</h2>
            <p className="text-[11px] text-gray-500">
              {formatBillingMonthLabel(billingMonth)} ·{' '}
              {houseFilter === 'ALL'
                ? 'All Houses & General'
                : houseFilter === 'OTHER'
                  ? 'General / Other'
                  : properties.find((p) => p.property_id === houseFilter)?.property_name}
            </p>
          </div>

          {!isReadOnly && (
            <button
              type="button"
              onClick={onOpenAddExpenses}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#489E44] hover:bg-[#3E8E41] px-4 py-2 text-xs font-bold text-white shadow-xs transition-colors cursor-pointer min-h-[40px] shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add Expense</span>
            </button>
          )}
        </div>

        {/* Horizontal Scrollable House Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setHouseFilter('ALL')}
            className={`px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              houseFilter === 'ALL'
                ? 'bg-[#489E44] text-white border-[#489E44]'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
          >
            All Houses
          </button>

          {properties.map((p) => (
            <button
              key={p.property_id}
              type="button"
              onClick={() => setHouseFilter(p.property_id)}
              className={`px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                houseFilter === p.property_id
                  ? 'bg-[#489E44] text-white border-[#489E44]'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {p.property_name}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setHouseFilter('OTHER')}
            className={`px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              houseFilter === 'OTHER'
                ? 'bg-[#489E44] text-white border-[#489E44]'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
          >
            General / Other
          </button>
        </div>

        {/* House-wise Breakdown Mini-Cards (3-Column Summary Row) */}
        <div className="grid grid-cols-3 gap-2">
          {houseBreakdown.houseRows.map((row) => (
            <button
              key={row.houseId}
              type="button"
              onClick={() =>
                setHouseFilter(houseFilter === row.houseId ? 'ALL' : row.houseId)
              }
              className={`rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                houseFilter === row.houseId
                  ? 'border-[#489E44] bg-emerald-50/70'
                  : 'border-gray-100 bg-gray-50/80 hover:bg-gray-100/70'
              }`}
            >
              <div className="text-[10px] font-semibold text-gray-500 truncate">
                {row.houseName}
              </div>
              <div className="text-xs font-extrabold text-[#0f172a] font-mono tabular-nums mt-0.5 truncate">
                {formatINR(row.amount)}
              </div>
            </button>
          ))}

          <button
            type="button"
            onClick={() => setHouseFilter(houseFilter === 'OTHER' ? 'ALL' : 'OTHER')}
            className={`rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
              houseFilter === 'OTHER'
                ? 'border-[#489E44] bg-emerald-50/70'
                : 'border-gray-100 bg-gray-50/80 hover:bg-gray-100/70'
            }`}
          >
            <div className="text-[10px] font-semibold text-gray-500 truncate">
              Other
            </div>
            <div className="text-xs font-extrabold text-[#0f172a] font-mono tabular-nums mt-0.5 truncate">
              {formatINR(houseBreakdown.otherAmount)}
            </div>
          </button>
        </div>

        {/* Compact Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by description or category..."
            aria-label="Search expenses"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 py-2.5 text-xs text-[#0f172a] placeholder:text-gray-400 min-h-[42px]"
          />
        </div>

        {/* View Mode Switcher (Card vs. Table) + Export PDF Action */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-100 bg-gray-50/80 px-3 py-2">
          <div className="text-xs font-bold text-[#0f172a]">
            {visibleTransactions.length} Expense{visibleTransactions.length === 1 ? '' : 's'}
          </div>

          <div className="flex items-center gap-2">
            <div
              className="inline-flex rounded-xl bg-gray-200/80 p-0.5"
              role="group"
              aria-label="Expense display view"
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
              disabled={visibleTransactions.length === 0}
              onClick={() => {
                const selectedHouseName =
                  houseFilter === 'ALL'
                    ? 'All Houses & General'
                    : houseFilter === 'OTHER'
                      ? 'General / Other'
                      : properties.find((p) => p.property_id === houseFilter)
                          ?.property_name || houseFilter;
                const summaryParts = [
                  `Period: ${formatBillingMonthLabel(billingMonth)}`,
                  `House: ${selectedHouseName}`,
                  searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : null,
                ].filter(Boolean);

                exportExpensesSummaryPdf({
                  expenses: visibleTransactions,
                  filterSummary: summaryParts.join('  |  '),
                  fileName: `SRKP-Expenses-${billingMonth}.pdf`,
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0f172a] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer min-h-[34px]"
            >
              <FileDown className="w-3.5 h-3.5 text-emerald-300" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        {/* Expense List: Card View or Compact Tabular View */}
        {visibleTransactions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-8 text-center space-y-2.5">
            <Receipt className="w-7 h-7 text-gray-400 mx-auto" />
            <div className="text-xs font-semibold text-gray-600">
              No expenses recorded for this month and filter.
            </div>
            {!isReadOnly && (
              <button
                type="button"
                onClick={onOpenAddExpenses}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#489E44] px-4 py-2 text-xs font-bold text-white hover:bg-[#3E8E41] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add First Expense</span>
              </button>
            )}
          </div>
        ) : viewMode === 'table' ? (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-[#3E8E41] text-white text-[11px] font-bold">
                    <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Category / Title</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Property / Unit</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Amount</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Notes / Description</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleTransactions.map((exp) => {
                    const houseIdx = properties.findIndex(
                      (p) => p.property_id === exp.house_id
                    );
                    return (
                      <tr
                        key={exp.id}
                        className="hover:bg-emerald-50/35 transition-colors align-middle"
                      >
                        <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap text-gray-700">
                          {exp.date}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-bold text-[#0f172a]">{exp.category}</div>
                          <div className="text-[10px] text-gray-400">
                            by {exp.created_by}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${getHousePillClasses(
                              exp.house_id,
                              houseIdx >= 0 ? houseIdx : 0
                            )}`}
                          >
                            {exp.house_name}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap font-extrabold text-rose-600">
                          -{formatINR(exp.amount)}
                        </td>
                        <td className="py-2.5 px-3 text-gray-700 max-w-[240px]">
                          <div className="line-clamp-2 break-words">{exp.description}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {isReadOnly ? (
                            <span className="text-[10px] text-gray-400">Read-Only</span>
                          ) : confirmDeleteId === exp.id ? (
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteExpense(exp.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-rose-700 cursor-pointer"
                              >
                                Confirm
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openEditModal(exp)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer"
                                aria-label={`Edit ${exp.description}`}
                                title="Edit Expense"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(exp.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-rose-600 hover:bg-rose-50 cursor-pointer"
                                aria-label={`Delete ${exp.description}`}
                                title="Delete Expense"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const totalVisible = visibleTransactions.reduce(
                      (sum, exp) => sum + Math.round(exp.amount || 0),
                      0
                    );
                    return (
                      <tr className="bg-emerald-50/90 border-t-2 border-[#3E8E41]/30 font-extrabold text-[#0f172a]">
                        <td className="py-2.5 px-3 whitespace-nowrap" colSpan={3}>
                          TOTAL ({visibleTransactions.length})
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-rose-700">
                          -{formatINR(totalVisible)}
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
          <div className="space-y-2.5">
            {visibleTransactions.map((exp) => {
              const visual = getCategoryVisual(exp.category);
              const CatIcon = visual.icon;
              const houseIdx = properties.findIndex(
                (p) => p.property_id === exp.house_id
              );

              return (
                <article
                  key={exp.id}
                  className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-xs space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${visual.badgeClass}`}
                      >
                        <CatIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-[#0f172a] break-words leading-snug">
                          {exp.description}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span>{exp.date}</span>
                          <span aria-hidden="true">·</span>
                          <span>{exp.category}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${getHousePillClasses(
                              exp.house_id,
                              houseIdx >= 0 ? houseIdx : 0
                            )}`}
                          >
                            {exp.house_name}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            by {exp.created_by}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-sm font-extrabold font-mono tabular-nums text-rose-600">
                        -{formatINR(exp.amount)}
                      </div>
                      {!isReadOnly && (
                        <div className="mt-2 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(exp)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer"
                            aria-label={`Edit ${exp.description}`}
                            title="Edit Expense"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDeleteId(
                                confirmDeleteId === exp.id ? null : exp.id
                              )
                            }
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-rose-600 hover:bg-rose-50 cursor-pointer"
                            aria-label={`Delete ${exp.description}`}
                            title="Delete Expense"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {confirmDeleteId === exp.id && (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px]">
                      <span className="font-semibold text-rose-800">
                        Delete this expense?
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-semibold text-gray-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteExpense(exp.id);
                            setConfirmDeleteId(null);
                          }}
                          className="rounded-lg bg-rose-600 px-2.5 py-1 font-bold text-white hover:bg-rose-700 cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Edit Expense Modal */}
      {editingExpense && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-3"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold text-[#0f172a]">Edit Expense</h3>
                <p className="text-xs text-gray-500">{editingExpense.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingExpense(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"
                aria-label="Close edit expense modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  House / Property
                </label>
                <select
                  value={editHouseId}
                  onChange={(e) => setEditHouseId(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-semibold text-[#0f172a] min-h-[42px]"
                >
                  {properties.map((p) => (
                    <option key={p.property_id} value={p.property_id}>
                      {p.property_name}
                    </option>
                  ))}
                  <option value="OTHER">General / Other</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-semibold text-[#0f172a] min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Category
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as ExpenseCategory)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2.5 text-xs font-semibold text-[#0f172a] min-h-[42px]"
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Description *
                </label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-xs font-medium text-[#0f172a] min-h-[42px]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Amount (₹) *
                </label>
                <input
                  type="number"
                  min={1}
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm font-mono tabular-nums font-bold text-[#0f172a] min-h-[44px]"
                />
              </div>

              {editError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingExpense(null)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 cursor-pointer min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#489E44] px-4 py-2 text-xs font-bold text-white hover:bg-[#3E8E41] cursor-pointer min-h-[40px]"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share WhatsApp P&L Summary Report Modal */}
      {showShareModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/55 backdrop-blur-xs p-3"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold text-[#0f172a]">
                  WhatsApp P&amp;L Summary Report
                </h3>
                <p className="text-xs text-gray-500">
                  {formatBillingMonthLabel(billingMonth)} · Ready to send
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"
                aria-label="Close P&L share modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <pre className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-xs font-mono text-[#0f172a] whitespace-pre-wrap leading-relaxed">
              {pnlReportText}
            </pre>

            <div className="space-y-2">
              {!isReadOnly && (
                <a
                  href={`https://wa.me/${normalizeWhatsAppDigits(
                    ownerWhatsappPhone
                  )}?text=${encodeURIComponent(pnlReportText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#489E44] hover:bg-[#3E8E41] px-4 py-3 text-xs font-bold text-white min-h-[44px]"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Send Report via WhatsApp</span>
                </a>
              )}

              <div className={isReadOnly ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 gap-2'}>
                {!isReadOnly && (
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(pnlReportText)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-[#0f172a] hover:bg-gray-50 min-h-[40px]"
                  >
                    <Share2 className="w-3.5 h-3.5 text-[#489E44]" />
                    <span>Choose Contact</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => void handleCopyReport()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-[#0f172a] hover:bg-gray-50 cursor-pointer min-h-[40px]"
                >
                  {copiedReport ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#489E44]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Report</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
