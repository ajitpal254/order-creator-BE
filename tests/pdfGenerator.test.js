/**
 * pdfGenerator.test.js — Vitest port
 * Tests that the Order PDF generator doesn't throw on various inputs.
 */
import { describe, it, expect } from 'vitest';
import { generateOrderPdf } from '../src/utils/pdfGenerator.js';

const BASE_ORDER = {
  orderNumber: 'HAO-2026-486331',
  orderType: 'Order',
  status: 'SUBMITTED',
  createdAt: new Date(),
  incoterm: 'FOB',
  currency: 'USD',
  customerDetails: {
    customerName: 'H.A. Overseas Admin',
    businessName: 'H.A. Overseas Corporation',
    country: 'India',
    phoneNumber: '+91 98765 43210',
    address: 'Industrial Area Phase-II, Punjab, India',
  },
  items: [
    {
      productName: 'GENSTAR Drop Forged Machinist Ball Pein Hammer',
      sku: 'HAO-HMR-117',
      brand: 'GENSTAR (H.A. Standard)',
      size: 'Standard',
      finish: 'Black Phosphate (Industrial)',
      color: 'Tactical Matte Black',
      quantity: 60,
      unitPrice: 4.8,
      totalPrice: 288.0,
    },
    {
      productName: 'GENSTAR Heavy Duty Combination Pliers with Soft Grip',
      sku: 'HAO-PL-130',
      brand: 'GENSTAR (H.A. Standard)',
      size: '6 Inch (150mm)',
      finish: 'Satin Matte Finish',
      color: 'Industrial Safety Red',
      quantity: 100,
      unitPrice: 3.4,
      totalPrice: 340.0,
    },
  ],
  totalQuantity: 160,
  estimatedWeightKg: 70,
  estimatedCartons: 5,
  totalAmount: 628.0,
  shippingMarks: 'H.A. OVERSEAS / ORDER LOT\nPORT OF DISCHARGE: BUYER PORT\nFRAGILE / HANDLE WITH CARE',
  specialInstructions: 'Export seaworthy 7-ply corrugated cartons.',
};

describe('generateOrderPdf — standard order', () => {
  it('produces a valid PDF buffer', async () => {
    const buffer = await generateOrderPdf(BASE_ORDER);
    expect(buffer).toBeTruthy();
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('generateOrderPdf — edge cases', () => {
  it('handles empty items array without throwing', async () => {
    const order = { ...BASE_ORDER, items: [], totalQuantity: 0, totalAmount: 0 };
    const buffer = await generateOrderPdf(order);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles very long product name and SKU without throwing', async () => {
    const order = {
      ...BASE_ORDER,
      items: [{
        productName: 'A'.repeat(300),
        sku: 'SKU-' + 'X'.repeat(100),
        brand: 'TestBrand',
        size: 'Standard',
        finish: 'Standard',
        color: 'Standard',
        quantity: 1,
        unitPrice: 1.0,
        totalPrice: 1.0,
      }],
    };
    const buffer = await generateOrderPdf(order);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles special characters in all string fields without throwing', async () => {
    const order = {
      ...BASE_ORDER,
      orderNumber: 'HAO-2026-SPEC!@#$%',
      shippingMarks: '<script>alert(1)</script> & "quotes" \'single\' \u0000 null-byte',
      customerDetails: {
        customerName: 'Test & Co. <Ltd>',
        businessName: '"International" Partners',
        country: 'Côte d\'Ivoire',
        phoneNumber: '+33 (0)1 23 45 67 89',
        address: '123 Straße, Münih, Germany — 80333',
      },
    };
    const buffer = await generateOrderPdf(order);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles Quote document type (RFQ prefix)', async () => {
    const order = { ...BASE_ORDER, orderType: 'Quote', orderNumber: 'RFQ-2026-123456' };
    const buffer = await generateOrderPdf(order);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});
