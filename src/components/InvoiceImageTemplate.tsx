import React from 'react';
import type { InvoiceRecord } from '../types/estate';
import {
  buildDefaultWaterReference,
  formatFullMonthYearLabel,
  formatINR,
  getInvoiceBreakdown,
} from '../utils/billingEngine';

interface InvoiceImageTemplateProps {
  invoice: InvoiceRecord;
  ebAccountFallback?: string;
  waterRr1Fallback?: string;
  waterRr2Fallback?: string;
}

const FONT_STACK = 'Arial, Helvetica, sans-serif';

const CELL_BASE: React.CSSProperties = {
  border: '1px solid #000000',
  padding: '8px 10px',
  textAlign: 'center',
  verticalAlign: 'middle',
  fontFamily: FONT_STACK,
  fontSize: '14px',
  lineHeight: '1.35',
  color: '#000000',
  backgroundColor: '#FFFFFF',
  boxSizing: 'border-box',
};

export const InvoiceImageTemplate: React.FC<InvoiceImageTemplateProps> = ({
  invoice,
  ebAccountFallback = '',
  waterRr1Fallback = '',
  waterRr2Fallback = '',
}) => {
  const floorAndUnit = `${invoice.floor || ''} ${invoice.unit_type || ''}`.trim() || invoice.unit_name;
  const monthHeader = formatFullMonthYearLabel(invoice.billing_month);

  const {
    rent: rentAmount,
    water: waterAmount,
    cleaning: cleaningAmount,
    motor: motorBill,
    others: othersAmount,
    totalAmount,
    eb: ebBillAmount,
    paidDateLabel,
  } = getInvoiceBreakdown(invoice);

  const waterRef =
    invoice.water_reference !== undefined && invoice.water_reference.trim() !== ''
      ? invoice.water_reference.trim()
      : buildDefaultWaterReference({
          waterRr1: waterRr1Fallback,
          waterRr2: waterRr2Fallback,
          prev1: invoice.water_prev_1,
          curr1: invoice.water_curr_1,
          prev2: invoice.water_prev_2,
          curr2: invoice.water_curr_2,
        });

  const kebAccId = (invoice.keb_account_id || ebAccountFallback || '').trim();

  return (
    <div
      style={{
        width: '440px',
        backgroundColor: '#FFFFFF',
        color: '#000000',
        fontFamily: FONT_STACK,
        margin: 0,
        padding: 0,
        boxSizing: 'border-box',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
          border: '1px solid #000000',
          backgroundColor: '#FFFFFF',
          fontFamily: FONT_STACK,
        }}
      >
        <colgroup>
          <col style={{ width: '76%' }} />
          <col style={{ width: '24%' }} />
        </colgroup>
        <tbody>
          {/* Row 1: Tenant Name + Floor & Unit Type */}
          <tr>
            <td
              colSpan={2}
              style={{
                ...CELL_BASE,
                backgroundColor: '#FFFF00',
                fontWeight: 700,
                fontSize: '15px',
              }}
            >
              {invoice.tenant_name} &nbsp; {floorAndUnit}
            </td>
          </tr>

          {/* Row 2: Billing Month & Year */}
          <tr>
            <td
              colSpan={2}
              style={{
                ...CELL_BASE,
                backgroundColor: '#FFFF00',
                fontWeight: 700,
                fontSize: '14px',
              }}
            >
              {monthHeader}
            </td>
          </tr>

          {/* Row 3: Rent */}
          <tr>
            <td style={CELL_BASE}>Rent</td>
            <td style={{ ...CELL_BASE, fontWeight: 600 }}>
              {formatINR(rentAmount)}
            </td>
          </tr>

          {/* Row 4: Water Bill + Meter Details */}
          <tr>
            <td style={CELL_BASE}>
              Water Bill{waterRef ? ` ${waterRef}` : ''}
            </td>
            <td style={{ ...CELL_BASE, fontWeight: 600 }}>
              {formatINR(waterAmount)}
            </td>
          </tr>

          {/* Row 5: Maintenance (Cleaning) */}
          <tr>
            <td style={CELL_BASE}>Maintenance (Cleaning)</td>
            <td style={{ ...CELL_BASE, fontWeight: 600 }}>
              {formatINR(cleaningAmount)}
            </td>
          </tr>

          {/* Row 6: Motor Bill */}
          <tr>
            <td style={CELL_BASE}>Motor Bill</td>
            <td style={{ ...CELL_BASE, fontWeight: 600 }}>
              {formatINR(motorBill)}
            </td>
          </tr>

          {/* Row 7: Others */}
          <tr>
            <td style={CELL_BASE}>Others</td>
            <td style={{ ...CELL_BASE, fontWeight: 600 }}>
              {formatINR(othersAmount)}
            </td>
          </tr>

          {/* Row 8: Total Amount */}
          <tr>
            <td
              style={{
                ...CELL_BASE,
                backgroundColor: '#FFFF00',
                fontWeight: 700,
              }}
            >
              Total Amount
            </td>
            <td
              style={{
                ...CELL_BASE,
                backgroundColor: '#FFC000',
                fontWeight: 700,
              }}
            >
              {formatINR(totalAmount)}
            </td>
          </tr>

          {/* Row 9: KEB Acc ID */}
          <tr>
            <td
              style={{
                ...CELL_BASE,
                color: '#C00000',
                fontWeight: 700,
              }}
            >
              KEB Acc ID: {kebAccId || 'N/A'}
            </td>
            <td style={CELL_BASE}>{'\u00A0'}</td>
          </tr>

          {/* Row 10: KEB (BESCOM) Bill */}
          <tr>
            <td style={CELL_BASE}>KEB (BESCOM) Bill</td>
            <td style={{ ...CELL_BASE, fontWeight: 700 }}>
              {formatINR(ebBillAmount)}
            </td>
          </tr>

          {/* Row 11: Paid Date (Blank when unpaid) */}
          <tr>
            <td
              style={{
                ...CELL_BASE,
                backgroundColor: '#FFFF00',
                fontWeight: 700,
              }}
            >
              Paid Date
            </td>
            <td
              style={{
                ...CELL_BASE,
                backgroundColor: '#FFC000',
                fontWeight: 700,
              }}
            >
              {paidDateLabel || '\u00A0'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
