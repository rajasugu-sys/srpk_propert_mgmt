import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  MessageSquare,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';
import {
  AuthSession,
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

interface AddExpensesViewProps {
  session: AuthSession;
  properties: PropertyHouse[];
  invoices: InvoiceRecord[];
  expenses: ExpenseRecord[];
  billingMonth: string;
  ownerWhatsappPhone: string;
  onBack: () => void;
  onChangeBillingMonth: (month: string) => void;
  onSaveExpensesBatch: (newExpenses: ExpenseRecord[]) => void;
}

interface DraftExpenseRow {
  tempId: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
}

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Plumbing / Repairs',
  'Painting & Maintenance',
  'Property Tax & Municipal',
  'Common Area EB / Water',
  'Cleaning & Security',
  'Other',
];

function createEmptyRow(): DraftExpenseRow {
  return {
    tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category: 'Plumbing / Repairs',
    description: '',
    amount: '',
  };
}

export const AddExpensesView: React.FC<AddExpensesViewProps> = ({
  session,
  properties,
  invoices,
  expenses,
  billingMonth,
  ownerWhatsappPhone,
  onBack,
  onChangeBillingMonth,
  onSaveExpensesBatch,
}) => {
  const [selectedHouseId, setSelectedHouseId] = useState<string>(
    properties[0]?.property_id || 'OTHER'
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(billingMonth);
  const [expenseDate, setExpenseDate] = useState<string>(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    return todayStr.startsWith(billingMonth) ? todayStr : `${billingMonth}-15`;
  });

  const [rows, setRows] = useState<DraftExpenseRow[]>([createEmptyRow()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  const monthOptions = useMemo(() => {
    const set = new Set<string>(['2026-12', '2026-11', '2026-10', billingMonth, selectedMonth]);
    invoices.forEach((inv) => {
      if (inv.billing_month) set.add(inv.billing_month);
    });
    expenses.forEach((exp) => {
      if (exp.month) set.add(exp.month);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [invoices, expenses, billingMonth, selectedMonth]);

  const handleMonthChange = (nextMonth: string) => {
    setSelectedMonth(nextMonth);
    onChangeBillingMonth(nextMonth);
    if (!expenseDate.startsWith(nextMonth)) {
      const dayPart = expenseDate.slice(8, 10) || '15';
      setExpenseDate(`${nextMonth}-${dayPart}`);
    }
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, createEmptyRow()]);
  };

  const handleRemoveRow = (tempId: string) => {
    setRows((prev) => {
      if (prev.length <= 1) return [createEmptyRow()];
      return prev.filter((r) => r.tempId !== tempId);
    });
  };

  const handleUpdateRow = <K extends keyof DraftExpenseRow>(
    tempId: string,
    key: K,
    value: DraftExpenseRow[K]
  ) => {
    setRows((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, [key]: value } : r))
    );
  };

  const batchTotal = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const n = Number(r.amount);
        return sum + (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
      }, 0),
    [rows]
  );

  const handleSaveBatch = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSavedBanner(null);

    if (!expenseDate) {
      setFormError('Please select a valid expense date.');
      return;
    }

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.description.trim()) {
        setFormError(`Item ${i + 1}: Description is required.`);
        return;
      }
      const amt = Number(row.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        setFormError(`Item ${i + 1}: Enter a valid amount greater than ₹0.`);
        return;
      }
    }

    const chosenHouse = properties.find((p) => p.property_id === selectedHouseId);
    const houseId = chosenHouse ? chosenHouse.property_id : 'OTHER';
    const houseName = chosenHouse ? chosenHouse.property_name : 'General / Other';
    const createdBy = session.accountLabel || session.username || 'Owner';
    const derivedMonth = expenseDate.length >= 7 ? expenseDate.slice(0, 7) : selectedMonth;

    const newRecords: ExpenseRecord[] = rows.map((row, idx) => ({
      id: `EXP-${derivedMonth.replace('-', '')}-${Date.now().toString().slice(-4)}${idx}`,
      date: expenseDate,
      month: derivedMonth,
      house_id: houseId,
      house_name: houseName,
      category: row.category,
      description: row.description.trim(),
      amount: Math.round(Number(row.amount)),
      created_by: createdBy,
    }));

    onSaveExpensesBatch(newRecords);
    setRows([createEmptyRow()]);
    setSavedBanner(
      `Saved ${newRecords.length} expense${newRecords.length === 1 ? '' : 's'} totaling ${formatINR(
        newRecords.reduce((s, r) => s + r.amount, 0)
      )} for ${houseName} and queued Google Sheets sync.`
    );
  };

  // Monthly P&L Summary Report computed live (includes saved expenses for selectedMonth)
  const monthlyPnL = useMemo(() => {
    const monthInvoices = invoices.filter((inv) => inv.billing_month === selectedMonth);
    const totalIncome = monthInvoices.reduce(
      (sum, inv) => sum + (inv.total_payable_to_owner || 0),
      0
    );

    const monthExpenses = expenses.filter((exp) => exp.month === selectedMonth);
    const expMap = new Map<string, number>();
    monthExpenses.forEach((exp) => {
      expMap.set(exp.house_id, (expMap.get(exp.house_id) || 0) + exp.amount);
    });

    const houseExpenses = properties.map((p) => ({
      houseName: p.property_name,
      amount: expMap.get(p.property_id) || 0,
    }));
    const otherExpenses = expMap.get('OTHER') || 0;
    const totalExpenses = monthExpenses.reduce((sum, exp) => sum + exp.amount, 0);

    return {
      month: selectedMonth,
      totalIncome,
      houseExpenses,
      otherExpenses,
      totalExpenses,
      netBalance: totalIncome - totalExpenses,
    };
  }, [invoices, expenses, properties, selectedMonth]);

  const reportText = useMemo(() => formatWhatsAppPnLReport(monthlyPnL), [monthlyPnL]);

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div>
      {/* Emerald Green Top Header */}
      <header className="bg-gradient-to-b from-[#489E44] to-[#3E8E41] text-white px-4 pt-4 pb-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25 transition-colors cursor-pointer"
            aria-label="Back to Expenses"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-white truncate">
              Add Expenses
            </h1>
            <p className="text-[11px] text-emerald-50/90 truncate mt-0.5">
              Record new expenses for houses
            </p>
          </div>
        </div>
      </header>

      {/* Curved White Lower Sheet */}
      <div className="bg-white rounded-t-[28px] -mt-5 pt-5 px-4 pb-24 min-h-[calc(100vh-110px)] space-y-5">
        {/* Multi-Item Expense Entry Form */}
        <form onSubmit={handleSaveBatch} className="space-y-4">
          <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-3.5 space-y-3">
            <div>
              <label className="block text-xs font-bold text-[#0f172a] mb-1">
                Select House
              </label>
              <select
                aria-label="Select House for Expenses"
                value={selectedHouseId}
                onChange={(e) => setSelectedHouseId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-[#0f172a] min-h-[42px]"
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
                <label className="block text-xs font-bold text-[#0f172a] mb-1">
                  Billing Month
                </label>
                <select
                  aria-label="Select Expense Billing Month"
                  value={selectedMonth}
                  onChange={(e) => handleMonthChange(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-[#0f172a] min-h-[42px]"
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {formatBillingMonthLabel(m)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0f172a] mb-1">
                  Expense Date
                </label>
                <input
                  type="date"
                  aria-label="Expense Date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-semibold text-[#0f172a] min-h-[42px]"
                />
              </div>
            </div>
          </div>

          {/* Dynamic Expense Items Repeater */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-[#0f172a]">
                Expense Items ({rows.length})
              </h2>
              <span className="text-[11px] font-medium text-gray-500">
                Add multiple items in one batch
              </span>
            </div>

            {rows.map((row, idx) => (
              <div
                key={row.tempId}
                className="rounded-2xl border border-gray-200 bg-white p-3.5 shadow-xs space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#3E8E41]">
                    Item #{idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(row.tempId)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 cursor-pointer"
                    aria-label={`Remove item ${idx + 1}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{rows.length > 1 ? 'Remove' : 'Clear'}</span>
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                    Category
                  </label>
                  <select
                    value={row.category}
                    onChange={(e) =>
                      handleUpdateRow(
                        row.tempId,
                        'category',
                        e.target.value as ExpenseCategory
                      )
                    }
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-[#0f172a] min-h-[40px]"
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-7">
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Description *
                    </label>
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) =>
                        handleUpdateRow(row.tempId, 'description', e.target.value)
                      }
                      placeholder="e.g., Borewell motor repair"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-[#0f172a] min-h-[40px]"
                    />
                  </div>

                  <div className="col-span-5">
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Amount (₹) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={row.amount}
                      onChange={(e) =>
                        handleUpdateRow(row.tempId, 'amount', e.target.value)
                      }
                      placeholder="0"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-mono tabular-nums font-bold text-[#0f172a] min-h-[40px]"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={handleAddRow}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 px-4 py-3 text-xs font-bold text-[#3E8E41] hover:bg-emerald-50 transition-colors cursor-pointer min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add Another Item</span>
            </button>
          </div>

          {formError && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {savedBanner && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 space-y-2.5">
              <div className="flex items-start gap-2 text-xs font-semibold text-[#3E8E41]">
                <CheckCircle2 className="w-4 h-4 text-[#489E44] shrink-0 mt-0.5" />
                <span>{savedBanner}</span>
              </div>
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-emerald-200 px-3 py-1.5 text-[11px] font-bold text-[#3E8E41] hover:bg-emerald-100/50 cursor-pointer"
              >
                <span>View Expenses Dashboard →</span>
              </button>
            </div>
          )}

          {/* Live Batch Total & Save Button */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-600">Total Amount</span>
              <span className="text-lg font-extrabold font-mono tabular-nums text-[#0f172a]">
                {formatINR(batchTotal)}
              </span>
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#489E44] hover:bg-[#3E8E41] px-4 py-3 text-xs font-bold text-white shadow-sm transition-colors cursor-pointer min-h-[48px]"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Save &amp; Sync to Sheets</span>
            </button>
          </div>
        </form>

        {/* WhatsApp P&L Summary Report Generator Card */}
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#0f172a]">
                WhatsApp P&amp;L Summary Report
              </h2>
              <p className="text-[11px] text-gray-500">
                Live monthly Income vs Expense breakdown for{' '}
                {formatBillingMonthLabel(selectedMonth)}
              </p>
            </div>
          </div>

          <pre className="rounded-xl border border-gray-200 bg-white p-3.5 text-[11px] font-mono text-[#0f172a] whitespace-pre-wrap leading-relaxed">
            {reportText}
          </pre>

          <div className="space-y-2">
            <a
              href={`https://wa.me/${normalizeWhatsAppDigits(
                ownerWhatsappPhone
              )}?text=${encodeURIComponent(reportText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#489E44] hover:bg-[#3E8E41] px-4 py-3 text-xs font-bold text-white min-h-[44px]"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Send Report via WhatsApp</span>
            </a>

            <div className="grid grid-cols-2 gap-2">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(reportText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#0f172a] hover:bg-gray-50 min-h-[40px]"
              >
                <Share2 className="w-3.5 h-3.5 text-[#489E44]" />
                <span>Share to Contact</span>
              </a>

              <button
                type="button"
                onClick={() => void handleCopyReport()}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#0f172a] hover:bg-gray-50 cursor-pointer min-h-[40px]"
              >
                {copiedReport ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#489E44]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Text</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
