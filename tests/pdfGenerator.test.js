import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOrderPdf } from '../src/utils/pdfGenerator.js';

test('PDF Generator: Generates valid PDF buffer with multi-line shipping marks without throwing', async () => {
  const mockOrder = {
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
      {
        productName: 'GENSTAR High Leverage Long Nose Pliers',
        sku: 'HAO-PL-131',
        brand: 'GENSTAR (H.A. Standard)',
        size: '6 Inch (150mm)',
        finish: 'Satin Matte Finish',
        color: 'Cobalt Blue',
        quantity: 100,
        unitPrice: 3.2,
        totalPrice: 320.0,
      },
    ],
    totalQuantity: 260,
    estimatedWeightKg: 114,
    estimatedCartons: 7,
    totalAmount: 948.0,
    shippingMarks: 'H.A. OVERSEAS / ORDER LOT\nPORT OF DISCHARGE: BUYER PORT\nFRAGILE / HANDLE WITH CARE',
    specialInstructions: 'Export seaworthy 7-ply corrugated cartons with inner water-proof plastic barrier.',
  };

  const buffer = await generateOrderPdf(mockOrder);
  assert.ok(buffer);
  assert.ok(buffer.length > 1000);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});
