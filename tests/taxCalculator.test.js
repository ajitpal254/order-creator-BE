import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInvoiceTotals, roundToTwoDecimals, getExportNote } from '../src/utils/taxCalculator.js';
import { numberToWordsIndian, numberToWordsInternational } from '../src/utils/numberToWords.js';

test('Tax Calculator: roundToTwoDecimals accurately handles floating-point math', () => {
  assert.equal(roundToTwoDecimals(10.126), 10.13);
  assert.equal(roundToTwoDecimals(10.124), 10.12);
  assert.equal(roundToTwoDecimals(0.1 + 0.2), 0.3);
  assert.equal(roundToTwoDecimals(199.999), 200.0);
});

test('Tax Calculator: GST invoice with IGST for inter-state buyer', () => {
  const invoiceData = {
    docType: 'gst_invoice',
    senderStateCode: '03', // Punjab
    recipientStateCode: '27', // Maharashtra
    items: [
      { quantity: 2, unitPrice: 500, discountPercent: 10, taxRate: 18 },
    ],
    discountType: 'amount',
    discountValue: 0,
    currency: 'INR',
  };

  // Item 1: 2 * 500 * (1 - 0.1) = 900
  // Tax (18% IGST) = 162
  // Grand Total = 1062
  const result = calculateInvoiceTotals(invoiceData);

  assert.equal(result.subtotal, 900);
  assert.equal(result.taxableAmount, 900);
  assert.equal(result.isIgst, true);
  assert.equal(result.igstAmount, 162);
  assert.equal(result.cgstAmount, 0);
  assert.equal(result.sgstAmount, 0);
  assert.equal(result.taxAmount, 162);
  assert.equal(result.grandTotal, 1062);
  assert.ok(result.totalInWords.includes('One Thousand Sixty Two'));
});

test('Tax Calculator: GST invoice with CGST and SGST split for intra-state buyer', () => {
  const invoiceData = {
    docType: 'gst_invoice',
    senderStateCode: '03', // Punjab
    recipientStateCode: '03', // Punjab (intra-state)
    items: [
      { quantity: 1, unitPrice: 1000, discountPercent: 0, taxRate: 18 },
    ],
    currency: 'INR',
  };

  const result = calculateInvoiceTotals(invoiceData);

  assert.equal(result.subtotal, 1000);
  assert.equal(result.isIgst, false);
  assert.equal(result.cgstAmount, 90);
  assert.equal(result.sgstAmount, 90);
  assert.equal(result.taxAmount, 180);
  assert.equal(result.grandTotal, 1180);
});

test('Tax Calculator: Commercial Export invoice is zero-rated tax with proper export note', () => {
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

  // Item 1: 100 * 4.5 = 450
  // Item 2: 50 * 10 * 0.9 = 450
  // Subtotal = 900
  // Overall discount = 50 -> Taxable = 850
  // Commercial invoice tax = 0
  // Grand total = 850 USD
  const result = calculateInvoiceTotals(invoiceData);

  assert.equal(result.subtotal, 900);
  assert.equal(result.discountAmount, 50);
  assert.equal(result.taxableAmount, 850);
  assert.equal(result.taxAmount, 0);
  assert.equal(result.grandTotal, 850);
  assert.ok(result.totalInWords.includes('EIGHT HUNDRED FIFTY'));

  const exportNote = getExportNote('commercial_invoice');
  assert.ok(exportNote.includes('EXPORT'));
});

test('Number to Words: Indian and International currency formats', () => {
  const indianWords = numberToWordsIndian(152345.5);
  assert.ok(indianWords.includes('One Lakh Fifty Two Thousand Three Hundred Forty Five'));
  assert.ok(indianWords.includes('Fifty Paise'));

  const intlWords = numberToWordsInternational(29483.97, 'TOTAL US$: ');

  assert.ok(intlWords.includes('TOTAL US$: TWENTY NINE THOUSAND FOUR HUNDRED EIGHTY THREE'));
  assert.ok(intlWords.includes('CENTS 97 ONLY'));
});
