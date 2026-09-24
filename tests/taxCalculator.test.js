/**
 * taxCalculator.test.js
 * Unit tests for server-side financial recalculation utility.
 * These are pure function tests — no DB required.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateInvoiceTotals,
  roundToTwoDecimals,
  getExportNote,
} from '../src/utils/taxCalculator.js';
import {
  numberToWordsIndian,
  numberToWordsInternational,
} from '../src/utils/numberToWords.js';

describe('roundToTwoDecimals', () => {
  it('rounds up correctly', () => expect(roundToTwoDecimals(10.126)).toBe(10.13));
  it('rounds down correctly', () => expect(roundToTwoDecimals(10.124)).toBe(10.12));
  it('handles floating-point imprecision (0.1 + 0.2)', () => expect(roundToTwoDecimals(0.1 + 0.2)).toBe(0.3));
  it('rounds 199.999 to 200.00', () => expect(roundToTwoDecimals(199.999)).toBe(200.0));
  it('returns 0 for null/undefined inputs', () => {
    expect(roundToTwoDecimals(null)).toBe(0);
    expect(roundToTwoDecimals(undefined)).toBe(0);
  });
});

describe('calculateInvoiceTotals — GST Invoice (IGST inter-state)', () => {
  const invoiceData = {
    docType: 'gst_invoice',
    senderStateCode: '03',   // Punjab
    recipientStateCode: '27', // Maharashtra
    items: [{ quantity: 2, unitPrice: 500, discountPercent: 10, taxRate: 18 }],
    discountType: 'amount',
    discountValue: 0,
    currency: 'INR',
  };

  it('calculates subtotal after per-line discount', () => {
    // 2 * 500 = 1000 lineSubtotal; 10% off = 900 lineNet
    expect(calculateInvoiceTotals(invoiceData).subtotal).toBe(900);
  });

  it('applies IGST (inter-state flag is true)', () => {
    const r = calculateInvoiceTotals(invoiceData);
    expect(r.isIgst).toBe(true);
    expect(r.igstAmount).toBe(162);
    expect(r.cgstAmount).toBe(0);
    expect(r.sgstAmount).toBe(0);
    expect(r.taxAmount).toBe(162);
  });

  it('computes correct grand total', () => {
    expect(calculateInvoiceTotals(invoiceData).grandTotal).toBe(1062);
  });

  it('produces Indian-language total-in-words', () => {
    expect(calculateInvoiceTotals(invoiceData).totalInWords).toMatch(/One Thousand Sixty Two/);
  });
});

describe('calculateInvoiceTotals — GST Invoice (CGST+SGST intra-state)', () => {
  const invoiceData = {
    docType: 'gst_invoice',
    senderStateCode: '03',
    recipientStateCode: '03', // Same state
    items: [{ quantity: 1, unitPrice: 1000, discountPercent: 0, taxRate: 18 }],
    currency: 'INR',
  };

  it('splits into CGST and SGST for intra-state', () => {
    const r = calculateInvoiceTotals(invoiceData);
    expect(r.isIgst).toBe(false);
    expect(r.cgstAmount).toBe(90);
    expect(r.sgstAmount).toBe(90);
    expect(r.taxAmount).toBe(180);
    expect(r.grandTotal).toBe(1180);
  });
});

describe('calculateInvoiceTotals — Commercial Export Invoice', () => {
  const invoiceData = {
    docType: 'commercial_invoice',
    currency: 'USD',
    items: [
      { quantity: 100, unitPrice: 4.5, discountPercent: 0 },
      { quantity: 50, unitPrice: 10.0, discountPercent: 10 },
    ],
    discountType: 'amount',
    discountValue: 50,
  };

  it('calculates subtotal before invoice-level discount', () => {
    // Item 1: 100 * 4.5 = 450; Item 2: 50 * 10 * 0.9 = 450; total = 900
    expect(calculateInvoiceTotals(invoiceData).subtotal).toBe(900);
  });

  it('applies invoice-level discount', () => {
    expect(calculateInvoiceTotals(invoiceData).discountAmount).toBe(50);
    expect(calculateInvoiceTotals(invoiceData).taxableAmount).toBe(850);
  });

  it('is zero-rated (no tax on export)', () => {
    const r = calculateInvoiceTotals(invoiceData);
    expect(r.taxAmount).toBe(0);
    expect(r.grandTotal).toBe(850);
  });

  it('produces international-style total-in-words', () => {
    expect(calculateInvoiceTotals(invoiceData).totalInWords).toMatch(/EIGHT HUNDRED FIFTY/);
  });
});

describe('calculateInvoiceTotals — Edge Cases', () => {
  it('handles empty items array gracefully', () => {
    const r = calculateInvoiceTotals({ items: [], docType: 'commercial_invoice', currency: 'USD' });
    expect(r.subtotal).toBe(0);
    expect(r.grandTotal).toBe(0);
    expect(r.totalQty).toBe(0);
  });

  it('handles items with very long description strings without throwing', () => {
    const longDesc = 'A'.repeat(500);
    const r = calculateInvoiceTotals({
      items: [{ quantity: 1, unitPrice: 10, productName: longDesc, description: longDesc }],
      docType: 'commercial_invoice',
      currency: 'USD',
    });
    expect(r.grandTotal).toBe(10);
  });

  it('handles special characters in product name without throwing', () => {
    const r = calculateInvoiceTotals({
      items: [{ quantity: 1, unitPrice: 5, productName: '<script>alert(1)</script> & "quotes" \'single\'', description: '' }],
      docType: 'commercial_invoice',
      currency: 'USD',
    });
    expect(r.grandTotal).toBe(5);
  });

  it('caps discount at subtotal (no negative taxableAmount)', () => {
    const r = calculateInvoiceTotals({
      items: [{ quantity: 1, unitPrice: 100 }],
      discountType: 'amount',
      discountValue: 9999, // discount > subtotal
      docType: 'commercial_invoice',
      currency: 'USD',
    });
    expect(r.taxableAmount).toBeGreaterThanOrEqual(0);
  });

  it('handles percent discount type', () => {
    const r = calculateInvoiceTotals({
      items: [{ quantity: 1, unitPrice: 200 }],
      discountType: 'percent',
      discountValue: 25,
      docType: 'commercial_invoice',
      currency: 'USD',
    });
    // 200 * 75% = 150
    expect(r.taxableAmount).toBe(150);
    expect(r.grandTotal).toBe(150);
  });
});

describe('getExportNote', () => {
  it('returns EXPORT note for commercial_invoice', () => {
    expect(getExportNote('commercial_invoice')).toMatch(/EXPORT/);
  });

  it('returns LUT note for gst_invoice with WO PAY', () => {
    expect(getExportNote('gst_invoice', 'WO PAY')).toMatch(/BOND OR LETTER/);
  });

  it('returns WITH PAYMENT note for gst_invoice with W PAY', () => {
    expect(getExportNote('gst_invoice', 'W PAY')).toMatch(/PAYMENT OF INTEGRATED TAX/);
  });
});

describe('numberToWords', () => {
  it('formats Indian number with lakhs and paise', () => {
    const words = numberToWordsIndian(152345.5);
    expect(words).toMatch(/One Lakh Fifty Two Thousand Three Hundred Forty Five/);
    expect(words).toMatch(/Fifty Paise/);
  });

  it('formats international number with cents', () => {
    const words = numberToWordsInternational(29483.97, 'TOTAL US$: ');
    expect(words).toMatch(/TOTAL US\$: TWENTY NINE THOUSAND FOUR HUNDRED EIGHTY THREE/);
    expect(words).toMatch(/CENTS 97 ONLY/);
  });
});
