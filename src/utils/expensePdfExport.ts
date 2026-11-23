import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ExpenseRecord } from '../types/estate';

function formatPdfINR(amount: number): string {
  const formatted = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Math.round(amount || 0));
  return `Rs. ${formatted}`;
}

export interface ExportExpensesPdfOptions {
  expenses: ExpenseRecord[];
  filterSummary: string;
  reportTitle?: string;
  fileName?: string;
}

export function exportExpensesSummaryPdf({
  expenses,
  filterSummary,
  reportTitle = 'SRKP Rental Management — Expense Summary Report',
  fileName = 'SRKP-Rental-Tool-Expenses.pdf',
}: ExportExpensesPdfOptions): void {
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

  const totalExpense = expenses.reduce((sum, exp) => sum + Math.round(exp.amount || 0), 0);

  const dates = expenses
    .map((e) => e.date)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const dateRangeLabel =
    dates.length > 0
      ? dates[0] === dates[dates.length - 1]
        ? dates[0]
        : `${dates[0]} to ${dates[dates.length - 1]}`
      : 'No entries';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Items: ${expenses.length}   |   Date Range: ${dateRangeLabel}   |   Total Expenses: ${formatPdfINR(
      totalExpense
    )}`,
    marginX,
    67
  );

  const rows = expenses.map((exp) => [
    exp.date,
    exp.category,
    exp.house_name,
    exp.description || '-',
    exp.created_by || 'Owner',
    formatPdfINR(exp.amount),
  ]);

  autoTable(doc, {
    startY: 78,
    margin: { left: marginX, right: marginX, bottom: 32 },
    head: [
      [
        'Date',
        'Category / Title',
        'Property / Unit',
        'Notes / Description',
        'Recorded By',
        'Amount',
      ],
    ],
    body: rows,
    foot: [
      [
        `TOTAL (${expenses.length})`,
        '',
        '',
        '',
        '',
        formatPdfINR(totalExpense),
      ],
    ],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: { top: 6, right: 6, bottom: 6, left: 6 },
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.5,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [62, 142, 65],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    footStyles: {
      fillColor: [236, 253, 245],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 9,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 78, halign: 'left' },
      1: { cellWidth: 140, halign: 'left' },
      2: { cellWidth: 120, halign: 'left' },
      3: { cellWidth: 266, halign: 'left' },
      4: { cellWidth: 82, halign: 'left' },
      5: { cellWidth: 92, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.column.index === 5) {
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
        `SRKP Rental Tool · Expense Summary Statement`,
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
