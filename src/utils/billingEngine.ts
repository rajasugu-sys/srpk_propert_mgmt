import type { InvoiceRecord, TenantRecord } from '../types/estate.ts';

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function formatCompactINR(amount: number): string {
  const n = Math.round(amount || 0);
  if (n >= 10000000) {
    return `₹${(n / 10000000).toFixed(2).replace(/\.?0+$/, '')}Cr`;
  }
  if (n >= 100000) {
    return `₹${(n / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  }
  if (n >= 1000) {
    return `₹${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `₹${n}`;
}

export function formatBillingMonthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (!y || !m) return yyyyMm;
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function normalizeWhatsAppDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function formatFullMonthYearLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (!y || !m) return yyyyMm;
  const date = new Date(y, m - 1, 1);
  const fullMonth = date.toLocaleDateString('en-IN', { month: 'long' });
  return `${fullMonth} Month - ${y}`;
}

export function formatInvoicePaidDate(paidAt: string | null | undefined): string {
  if (!paidAt || !String(paidAt).trim()) return '';
  const raw = String(paidAt).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (isoMatch) {
    const d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mmm = d.toLocaleDateString('en-IN', { month: 'short' });
      const yyyy = d.getFullYear();
      return `${dd}-${mmm}-${yyyy}`;
    }
  }
  return raw;
}

export function buildDefaultWaterReference(params: {
  waterRr1?: string;
  waterRr2?: string;
  prev1: number;
  curr1: number;
  prev2?: number;
  curr2?: number;
}): string {
  const parts: string[] = [];
  const rr1 = (params.waterRr1 || '').trim();
  const rr2 = (params.waterRr2 || '').trim();
  const p1 = Math.round(params.prev1 || 0);
  const c1 = Math.round(params.curr1 || 0);
  const p2 = Math.round(params.prev2 || 0);
  const c2 = Math.round(params.curr2 || 0);

  if (rr1 || c1 > 0 || p1 > 0) {
    parts.push(`(${rr1 ? `${rr1}-` : ''}${p1}/${c1})`);
  }
  if (rr2 || c2 > 0 || p2 > 0) {
    parts.push(`(${rr2 ? `${rr2}-` : 'M2-'}${p2}/${c2})`);
  }
  return parts.join('');
}

export function isInvoiceLockedStatus(status: InvoiceRecord['payment_status']): boolean {
  return status === 'Partially Paid & Closed' || status === 'Paid & Closed';
}

export interface InvoiceBreakdownSummary {
  rent: number;
  water: number;
  cleaning: number;
  motor: number;
  others: number;
  totalAmount: number;
  eb: number;
  ebModeLabel: 'Owner' | 'Direct';
  paidDateLabel: string;
}

export function getInvoiceBreakdown(inv: InvoiceRecord): InvoiceBreakdownSummary {
  const rent = Math.round(inv.rent_amount || 0);
  const water = Math.round(inv.water_amount || 0);
  const cleaning = Math.round(inv.tenant_cleaning_fee || 0);

  const motorFromItems = inv.building_maintenance_items.find(
    (item) =>
      item.name.toLowerCase().includes('motor') ||
      item.name.toLowerCase().includes('common')
  );
  const motor =
    inv.motor_bill_amount !== undefined
      ? Math.round(inv.motor_bill_amount)
      : motorFromItems && inv.building_unit_count > 0
        ? Math.round(motorFromItems.amount / inv.building_unit_count)
        : 0;

  const others =
    inv.others_amount !== undefined
      ? Math.round(inv.others_amount)
      : Math.max(
          0,
          Math.round(
            inv.building_maintenance_share -
              motor +
              (inv.carried_forward_balance || 0)
          )
        );

  const totalAmount = rent + water + cleaning + motor + others;
  const eb = Math.round(inv.eb_amount || 0);
  const ebModeLabel: 'Owner' | 'Direct' = inv.eb_paid_to_owner ? 'Owner' : 'Direct';
  const paidDateLabel = formatInvoicePaidDate(inv.paid_at);

  return {
    rent,
    water,
    cleaning,
    motor,
    others,
    totalAmount,
    eb,
    ebModeLabel,
    paidDateLabel,
  };
}


export function getFloorSortRank(floor: string): number {
  const f = floor.toLowerCase();
  if (f.includes('ground') || f === 'gf' || f === '0') return 0;
  const match = f.match(/(\d+)/);
  if (match) return Number(match[1]);
  return 99;
}

export function calculateLeaseEndDate(
  moveInDate: string,
  tenureMonths: number
): string {
  const safeTenure = Math.max(1, Math.round(tenureMonths || 11));
  const parts = moveInDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    const now = new Date();
    now.setMonth(now.getMonth() + safeTenure);
    return now.toISOString().slice(0, 10);
  }
  const [y, m, d] = parts;
  const targetYear = y + Math.floor((m - 1 + safeTenure) / 12);
  const targetMonth = (m - 1 + safeTenure) % 12;
  const maxDayInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(d, maxDayInMonth);
  const yyyy = String(targetYear).padStart(4, '0');
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export interface TenureRemainingInfo {
  daysRemaining: number;
  monthsRemainingExact: number;
  wholeMonths: number;
  remDays: number;
  isExpiringSoon: boolean; // monthsRemainingExact <= 4 && monthsRemainingExact >= 0
  isExpired: boolean;
  label: string;
}

export function getTenureRemainingInfo(
  leaseEndDate: string,
  referenceDate: Date = new Date()
): TenureRemainingInfo {
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const parts = leaseEndDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return {
      daysRemaining: 999,
      monthsRemainingExact: 12,
      wholeMonths: 12,
      remDays: 0,
      isExpiringSoon: false,
      isExpired: false,
      label: '12m left',
    };
  }
  const end = new Date(parts[0], parts[1] - 1, parts[2]);
  const diffMs = end.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffMs / 86400000);

  if (daysRemaining < 0) {
    return {
      daysRemaining,
      monthsRemainingExact: daysRemaining / 30.4375,
      wholeMonths: 0,
      remDays: 0,
      isExpiringSoon: false,
      isExpired: true,
      label: `Expired ${Math.abs(daysRemaining)}d ago`,
    };
  }

  let wholeMonths =
    (end.getFullYear() - today.getFullYear()) * 12 +
    (end.getMonth() - today.getMonth());
  let anchor = new Date(today.getFullYear(), today.getMonth() + wholeMonths, today.getDate());
  if (anchor.getTime() > end.getTime()) {
    wholeMonths = Math.max(0, wholeMonths - 1);
    anchor = new Date(today.getFullYear(), today.getMonth() + wholeMonths, today.getDate());
  }
  const remDays = Math.max(
    0,
    Math.ceil((end.getTime() - anchor.getTime()) / 86400000)
  );
  const monthsRemainingExact = wholeMonths + remDays / 30.4375;
  const isExpiringSoon = monthsRemainingExact <= 4 && monthsRemainingExact >= 0;

  const label =
    wholeMonths > 0
      ? `${wholeMonths}m ${remDays}d left`
      : `${remDays} day${remDays === 1 ? '' : 's'} left`;

  return {
    daysRemaining,
    monthsRemainingExact,
    wholeMonths,
    remDays,
    isExpiringSoon,
    isExpired: false,
    label,
  };
}

export function formatTenureReminderWhatsApp(params: {
  recipient: 'tenant' | 'owner';
  tenant: TenantRecord;
  propertyName: string;
  unitName: string;
  remainingLabel: string;
  senderSignature?: string;
}): string {
  const {
    recipient,
    tenant,
    propertyName,
    unitName,
    remainingLabel,
    senderSignature = 'SRKP Rental Management',
  } = params;
  if (recipient === 'tenant') {
    return [
      `*${propertyName} — Lease / Rental Tenure Expiry Reminder*`,
      `Dear *${tenant.full_name}*,`,
      ``,
      `This is a gentle reminder that your ${tenant.lease_type} agreement for *${unitName}* at *${propertyName}* is scheduled to end on *${tenant.lease_end_date}* (*${remainingLabel}*).`,
      `Agreement Tenure: ${tenant.tenure_months} months (Move-In: ${tenant.move_in_date})`,
      ``,
      `Kindly confirm if you wish to renew your agreement for the next term or schedule a move-out inspection.`,
      ``,
      `Regards,`,
      senderSignature,
    ].join('\n');
  }

  return [
    `*Owner Alert: Tenure Expiring Soon — ${propertyName}*`,
    `Unit: *${unitName}*`,
    `Tenant: *${tenant.full_name}* (${tenant.whatsapp_phone})`,
    `Agreement Type: ${tenant.lease_type} (${tenant.tenure_months} months)`,
    `Move-In: ${tenant.move_in_date} | End Date: *${tenant.lease_end_date}*`,
    `Remaining Tenure: *${remainingLabel}*`,
    ``,
    `Action: Discuss renewal terms or initiate move-out checklist.`,
  ].join('\n');
}

export function formatWhatsAppPnLReport(params: {
  month: string;
  totalIncome: number;
  houseExpenses: Array<{ houseName: string; amount: number }>;
  otherExpenses: number;
  totalExpenses: number;
  netBalance: number;
  senderSignature?: string;
}): string {
  const monthLabel = formatBillingMonthLabel(params.month);
  const houseLines = params.houseExpenses.map(
    (h) => `• ${h.houseName}: ${formatINR(h.amount)}`
  );

  return [
    `*Monthly Financial Summary - ${monthLabel}*`,
    params.senderSignature || 'SRKP Rental Management',
    `--------------------------------`,
    `Total Income: *${formatINR(params.totalIncome)}*`,
    ``,
    `*Expenses Breakdown:*`,
    ...(houseLines.length > 0 ? houseLines : ['• Houses: ₹0']),
    `• General / Other: ${formatINR(params.otherExpenses)}`,
    `Total Expenses: *${formatINR(params.totalExpenses)}*`,
    `--------------------------------`,
    `*Net Balance (Income - Expense): ${
      params.netBalance < 0 ? '-' : ''
    }${formatINR(Math.abs(params.netBalance))}*`,
  ].join('\n');
}

export interface InvoiceDueTiming {
  isOverdue: boolean;
  isDueSoon: boolean;
  label: string;
  dueDate: string;
}

export function getInvoiceDueTiming(
  invoice: InvoiceRecord,
  referenceDate: Date = new Date()
): InvoiceDueTiming {
  const dueDate = invoice.due_date || `${invoice.billing_month}-05`;
  if (invoice.is_locked || invoice.balance_due <= 0) {
    return { isOverdue: false, isDueSoon: false, label: 'Settled', dueDate };
  }
  const parts = dueDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return { isOverdue: false, isDueSoon: false, label: 'Due', dueDate };
  }
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) {
    return {
      isOverdue: true,
      isDueSoon: false,
      label: `Overdue ${Math.abs(diffDays)}d`,
      dueDate,
    };
  }
  if (diffDays <= 5) {
    return {
      isOverdue: false,
      isDueSoon: true,
      label: diffDays === 0 ? 'Due Today' : `Due in ${diffDays}d`,
      dueDate,
    };
  }
  return { isOverdue: false, isDueSoon: false, label: `Due ${dueDate}`, dueDate };
}
