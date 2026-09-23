import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCommercialInvoicePdf } from '../src/utils/pdfGenerator.js';

test('Invoice PDF: Generates valid Commercial Invoice PDF with complete data', async () => {
  const mockInvoice = {
    invoiceNumber: 'INV-2026-992144',
    docType: 'commercial_invoice',
    status: 'sent',
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
    items: [
      {
        productName: 'Heavy Duty Machinist Hammer with Soft Grip',
        sku: 'HAO-HMR-201',
        hsnCode: '8205.59',
        quantity: 500,
        unit: 'PCS',
        unitPrice: 5.25,
        discountPercent: 5,
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

  const buffer = await generateCommercialInvoicePdf(mockInvoice);
  assert.ok(buffer);
  assert.ok(buffer.length > 1000);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

test('Invoice PDF: Handles edge-case input (empty items, very long strings, special characters)', async () => {
  const edgeCaseInvoice = {
    invoiceNumber: 'INV-EDGE-CASE-!@#$%^&*()_+',
    docType: 'gst_invoice',
    status: 'draft',
    currency: 'INR',
    customerDetails: {
      customerName: 'Extremely Long Customer Name With Special Characters & Symbols: <script>alert(1)</script> [Test] (UK) "Company"',
      businessName: 'A'.repeat(200),
      country: 'India',
      phoneNumber: '+91 99999 99999',
      address: 'Line 1 \n Line 2 \n Line 3 \n Line 4 \n Very Long Address Details That Span Across Multiple Lines Without Crashing The PDF Rendering Engine'.repeat(3),
    },
    items: [], // empty line items
    subtotal: 0,
    grandTotal: 0,
    amountPaid: 0,
    balanceDue: 0,
    totalInWords: 'Zero Rupees Only',
  };

  const buffer = await generateCommercialInvoicePdf(edgeCaseInvoice);
  assert.ok(buffer);
  assert.ok(buffer.length > 500);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});
