import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { InvoiceRecord } from '../types/estate';
import { formatBillingMonthLabel, getInvoiceBreakdown } from './billingEngine';

function formatPdfINR(amount: number): string {
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Math.round(amount || 0));
  return `Rs. ${formatted}`;
}

export interface ExportInvoicesPdfOptions {
  invoices: InvoiceRecord[];
  filterSummary: string;
  reportTitle?: string;
  fileName?: string;
}

export function exportInvoicesSummaryPdf({
  invoices,
  filterSummary,
  reportTitle = 'SRKP Rental Management — Invoice Summary Report',
  fileName = 'SRKP-Rental-Tool-Invoices.pdf',
}: ExportInvoicesPdfOptions): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 32;

  // Brand Accent Strip
  doc.setFillColor(62, 142, 65);
  doc.rect(0, 0, pageWidth, 8, 'F');

  // Report Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(reportTitle, marginX, 34);

  const generatedLabel = `Generated: ${new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })} ${new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(generatedLabel, pageWidth - marginX, 34, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(62, 142, 65);
  doc.text(filterSummary, marginX, 51);

  let sumRent = 0;
  let sumWater = 0;
  let sumMaint = 0;
  let sumMotor = 0;
  let sumOthers = 0;
  let sumTotal = 0;
  let sumEb = 0;
  let sumCollected = 0;

  const rows = invoices.map((inv) => {
    const b = getInvoiceBreakdown(inv);
    sumRent += b.rent;
    sumWater += b.water;
    sumMaint += b.cleaning;
    sumMotor += b.motor;
    sumOthers += b.others;
    sumTotal += b.totalAmount;
    sumEb += b.eb;
    sumCollected += Math.round(inv.amount_paid || 0);

    return [
      `${inv.unit_name} (${inv.floor})\n${inv.tenant_name}`,
      formatBillingMonthLabel(inv.billing_month),
      formatPdfINR(b.rent),
      formatPdfINR(b.water),
      formatPdfINR(b.cleaning),
      formatPdfINR(b.motor),
      formatPdfINR(b.others),
      formatPdfINR(b.totalAmount),
      `${formatPdfINR(b.eb)}\n${b.ebCollectionMode}${
        b.ebPaidDateLabel ? `\n${b.ebPaidDateLabel}` : ''
      }`,
      inv.payment_status,
      b.paidDateLabel || '-',
    ];
  });

  // Summary KPI line right above table
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Invoices: ${invoices.length}   |   Rent + Utilities Total: ${formatPdfINR(
      sumTotal
    )}   |   KEB Total: ${formatPdfINR(sumEb)}   |   Collected: ${formatPdfINR(sumCollected)}`,
    marginX,
    67
  );

  autoTable(doc, {
    startY: 78,
    margin: { left: marginX, right: marginX, bottom: 32 },
    head: [
      [
        'Unit & Tenant',
        'Month',
        'Rent',
        'Water',
        'Maint',
        'Motor',
        'Others',
        'Total Amt',
        'KEB Bill',
        'Status',
        'Paid Date',
      ],
    ],
    body: rows,
    foot: [
      [
        `TOTAL (${invoices.length})`,
        '',
        formatPdfINR(sumRent),
        formatPdfINR(sumWater),
        formatPdfINR(sumMaint),
        formatPdfINR(sumMotor),
        formatPdfINR(sumOthers),
        formatPdfINR(sumTotal),
        formatPdfINR(sumEb),
        '',
        '',
      ],
    ],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 5, right: 5, bottom: 5, left: 5 },
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [62, 142, 65],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    footStyles: {
      fillColor: [236, 253, 245],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 138, halign: 'left' },
      1: { cellWidth: 56, halign: 'left' },
      2: { cellWidth: 62, halign: 'right' },
      3: { cellWidth: 56, halign: 'right' },
      4: { cellWidth: 54, halign: 'right' },
      5: { cellWidth: 54, halign: 'right' },
      6: { cellWidth: 54, halign: 'right' },
      7: { cellWidth: 66, halign: 'right', fontStyle: 'bold' },
      8: { cellWidth: 66, halign: 'right' },
      9: { cellWidth: 96, halign: 'left' },
      10: { cellWidth: 64, halign: 'left' },
    },
    didParseCell: (data) => {
      // Align numeric head & foot headers right to match body cells
      if (data.column.index >= 2 && data.column.index <= 8) {
        data.cell.styles.halign = 'right';
      }
    },
    didDrawPage: () => {
      const pageCount = doc.getNumberOfPages();
      const currentPage = doc.getCurrentPageInfo().pageNumber;
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `SRKP Rental Tool · Confidential Owner Statement`,
        marginX,
        pageHeight - 16
      );
      doc.text(
        `Page ${currentPage} of ${pageCount}`,
        pageWidth - marginX,
        pageHeight - 16,
        { align: 'right' }
      );
    },
  });

  doc.save(fileName);
}
