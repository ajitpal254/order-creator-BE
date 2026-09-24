/**
 * invoicePdf.test.js — Vitest port
 * Tests that the Invoice PDF generator doesn't throw on various inputs.
 * Specifically required by Phase 5: empty line items, very long strings,
 * and special characters.
 */
import { describe, it, expect } from 'vitest';
import { generateCommercialInvoicePdf } from '../src/utils/pdfGenerator.js';

const BASE_INVOICE = {
  invoiceNumber: 'INV-2026-992144',
  docType: 'commercial_invoice',
  status: 'draft',
  invoiceDate: new Date(),
  dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  incoterm: 'FOB',
  currency: 'USD',
  customerDetails: {
    customerName: 'Global Tools LLC',
    businessName: 'Global Tools Corporation',
    country: 'United States',
    phoneNumber: '+1-555-0199',
    address: 'Suite 400, Innovation Way, Detroit, MI 48201',
    taxId: 'US-EIN-99-1234567',
  },
  senderDetails: {
    companyName: 'H.A. OVERSEAS',
    address: 'Industrial Area Phase-II, Ludhiana, Punjab - 141003, India',
    phoneNumber: '+91-99884-65800',
    email: 'haoverseas1313@gmail.com',
    gstin: '03AAAAA0000A1Z5',
    iecNo: '0300000000',
    pan: 'AAAAA0000A',
    stateCode: '03',
  },
  items: [
    {
      productName: 'Heavy Duty Machinist Hammer',
      sku: 'HAO-HMR-201',
      hsnCode: '8205.59',
      quantity: 500,
      unit: 'PCS',
      unitPrice: 5.25,
      discountPercent: 5,
      lineSubtotal: 2625.0,
      lineDiscount: 131.25,
      lineNet: 2493.75,
      lineTax: 0,
      lineTotal: 2493.75,
    },
  ],
  subtotal: 2625.0,
  discountAmount: 131.25,
  taxableAmount: 2493.75,
  taxAmount: 0,
  grandTotal: 2493.75,
  amountPaid: 1000.0,
  balanceDue: 1493.75,
  totalInWords: 'TOTAL US$: TWO THOUSAND FOUR HUNDRED NINETY THREE AND CENTS 75 ONLY',
  shippingMarks: 'H.A. OVERSEAS / DETROIT LOT #44\nFRAGILE / EXPORT CARGO',
};

describe('generateCommercialInvoicePdf — standard invoice', () => {
  it('produces a valid PDF buffer', async () => {
    const buffer = await generateCommercialInvoicePdf(BASE_INVOICE);
    expect(buffer).toBeTruthy();
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('generateCommercialInvoicePdf — edge cases (Phase 5 required)', () => {
  it('handles empty items array without throwing', async () => {
    const invoice = {
      ...BASE_INVOICE,
      items: [],
      subtotal: 0,
      grandTotal: 0,
      amountPaid: 0,
      balanceDue: 0,
      totalInWords: 'Zero Dollars Only',
    };
    const buffer = await generateCommercialInvoicePdf(invoice);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles very long product name (500 chars) without throwing', async () => {
    const invoice = {
      ...BASE_INVOICE,
      items: [{
        productName: 'A'.repeat(500),
        sku: 'SKU-' + 'X'.repeat(100),
        hsnCode: '8205.59',
        quantity: 1,
        unit: 'PCS',
        unitPrice: 10,
        discountPercent: 0,
        lineSubtotal: 10,
        lineDiscount: 0,
        lineNet: 10,
        lineTax: 0,
        lineTotal: 10,
      }],
    };
    const buffer = await generateCommercialInvoicePdf(invoice);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles special characters in invoice number and customer name without throwing', async () => {
    const invoice = {
      ...BASE_INVOICE,
      invoiceNumber: 'INV-EDGE-!@#$%^&*()',
      customerDetails: {
        ...BASE_INVOICE.customerDetails,
        customerName: '<script>alert(1)</script> & "quotes" \'single\'',
        businessName: 'Müller & Söhne GmbH — "Partners"',
        address: 'Straße 123\nLine 2 & 3\nSpecial: <>&"\'\u0000',
      },
    };
    const buffer = await generateCommercialInvoicePdf(invoice);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles missing optional fields (senderDetails, shippingMarks) without throwing', async () => {
    const { senderDetails, shippingMarks, ...invoiceWithoutOptionals } = BASE_INVOICE;
    const buffer = await generateCommercialInvoicePdf(invoiceWithoutOptionals);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles GST invoice with IGST amounts without throwing', async () => {
    const invoice = {
      ...BASE_INVOICE,
      docType: 'gst_invoice',
      currency: 'INR',
      isIgst: true,
      igstAmount: 449.0,
      cgstAmount: 0,
      sgstAmount: 0,
      taxAmount: 449.0,
      taxRate: 18,
      grandTotal: 2942.75,
      balanceDue: 2942.75,
      totalInWords: 'Two Thousand Nine Hundred Forty Two Rupees And Seventy Five Paise Only',
    };
    const buffer = await generateCommercialInvoicePdf(invoice);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles fully-paid invoice (balanceDue = 0) without throwing', async () => {
    const invoice = {
      ...BASE_INVOICE,
      amountPaid: BASE_INVOICE.grandTotal,
      balanceDue: 0,
    };
    const buffer = await generateCommercialInvoicePdf(invoice);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});
