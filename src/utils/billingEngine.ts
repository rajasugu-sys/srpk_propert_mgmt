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

export function buildUpiPaymentLink(params: {
  upiId: string;
  payeeName: string;
  amount: number;
  note: string;
}): string {
  const safeAmt = Math.max(1, Math.round(params.amount));
  const qs = new URLSearchParams({
    pa: params.upiId.trim(),
    pn: params.payeeName.trim(),
    am: safeAmt.toFixed(2),
    cu: 'INR',
    tn: params.note.trim(),
  });
  return `upi://pay?${qs.toString()}`;
}

export function isInvoiceLockedStatus(status: InvoiceRecord['payment_status']): boolean {
  return status === 'Partially Paid & Closed' || status === 'Paid & Closed';
}

export function formatWhatsAppInvoiceMessage(
  invoice: InvoiceRecord,
  upiId: string
): string {
  const monthLabel = formatBillingMonthLabel(invoice.billing_month);
  const ebModeNote = invoice.eb_paid_to_owner
    ? 'Payable to Owner'
    : 'Paid Directly to Utility Provider';

  const waterLine =
    invoice.water_curr_2 > 0 || invoice.water_prev_2 > 0
      ? `• Water (M1: ${invoice.water_prev_1}→${invoice.water_curr_1}, M2: ${invoice.water_prev_2}→${invoice.water_curr_2} = ${invoice.water_net_units} units × ₹${invoice.water_rate}): ${formatINR(invoice.water_amount)}`
      : `• Water (${invoice.water_prev_1}→${invoice.water_curr_1} = ${invoice.water_net_units} units × ₹${invoice.water_rate}): ${formatINR(invoice.water_amount)}`;

  const bldgShareLine =
    invoice.building_maintenance_total > 0 && invoice.building_unit_count > 0
      ? `• Building Maint Share (${formatINR(invoice.building_maintenance_total)} ÷ ${invoice.building_unit_count} units): ${formatINR(invoice.building_maintenance_share)}`
      : `• Building Maint Share (Common EB & Repairs): ${formatINR(invoice.building_maintenance_share)}`;

  const arrearsLines =
    invoice.carried_forward_balance > 0
      ? [
          `• Previous Arrears / Carried Forward Balance: ${formatINR(invoice.carried_forward_balance)}`,
        ]
      : [];

  const paymentStatusLines =
    invoice.amount_paid > 0
      ? [
          `Amount Paid: ${formatINR(invoice.amount_paid)}`,
          `*Balance Due: ${formatINR(invoice.balance_due)}* (${invoice.payment_status})`,
        ]
      : [`Status: *${invoice.payment_status}*`];

  const lines = [
    `*${invoice.property_name} — Monthly Rent & Utility Receipt*`,
    `Month: *${monthLabel}*`,
    `House: *${invoice.property_name}*`,
    `Unit: *${invoice.unit_name}* (${invoice.unit_type} · ${invoice.floor})`,
    `Tenant: *${invoice.tenant_name}* (${invoice.lease_type})`,
    `Invoice ID: ${invoice.id}`,
    ``,
    `*Itemized Breakdown:*`,
    ...(invoice.lease_type === 'Rental'
      ? [`• Monthly Rent: ${formatINR(invoice.rent_amount)}`]
      : [`• Lease Terms: ₹0 Monthly Rent (Lease Deposit Active)`]),
    `• Monthly Cleaning Fee (Fixed Tenant Maint): ${formatINR(invoice.tenant_cleaning_fee)}`,
    bldgShareLine,
    waterLine,
    `• Unit Electricity (EB): ${formatINR(invoice.eb_amount)} _(${ebModeNote})_`,
    ...arrearsLines,
    `--------------------------------`,
    `Total Bill Value: ${formatINR(invoice.total_bill_value)}`,
    `*Total Payable to Owner: ${formatINR(invoice.total_payable_to_owner)}*`,
    ...paymentStatusLines,
    ``,
    `Pay Owner via UPI: *${upiId}*`,
    `UPI Link: ${invoice.upi_link}`,
    ``,
    `Thank you — SRKP Rental Management`,
  ];

  return lines.join('\n');
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
}): string {
  const { recipient, tenant, propertyName, unitName, remainingLabel } = params;
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
      `SRKP Rental Management`,
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
}): string {
  const monthLabel = formatBillingMonthLabel(params.month);
  const houseLines = params.houseExpenses.map(
    (h) => `• ${h.houseName}: ${formatINR(h.amount)}`
  );

  return [
    `*Monthly Financial Summary - ${monthLabel}*`,
    `SRKP Rental Management`,
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
