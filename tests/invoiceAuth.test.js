/**
 * invoiceAuth.test.js — Vitest port
 * Tests Zod validation schemas and the MongoDB sanitizer middleware.
 * Pure unit tests — no DB required.
 */
import { describe, it, expect } from 'vitest';
import {
  createInvoiceSchema,
  recordPaymentSchema,
  voidInvoiceSchema,
  updateInvoiceSchema,
} from '../src/middleware/validate.js';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';

describe('createInvoiceSchema — valid payloads', () => {
  it('parses a minimal valid commercial invoice payload', async () => {
    const payload = {
      docType: 'commercial_invoice',
      currency: 'USD',
      incoterm: 'FOB',
      customerDetails: {
        customerName: 'Acme International',
        businessName: 'Acme Hardware Ltd',
        country: 'Canada',
      },
      items: [{ productName: 'Ball Pein Hammer', quantity: 50, unitPrice: 4.5 }],
    };
    const parsed = await createInvoiceSchema.parseAsync(payload);
    expect(parsed.customerDetails.customerName).toBe('Acme International');
    expect(parsed.items[0].quantity).toBe(50);
    expect(parsed.items[0].unitPrice).toBe(4.5);
  });

  it('accepts eway_bill as a valid docType', async () => {
    const parsed = await createInvoiceSchema.parseAsync({
      docType: 'eway_bill',
      customerDetails: { customerName: 'Test Buyer' },
      items: [{ quantity: 1, unitPrice: 10 }],
    });
    expect(parsed.docType).toBe('eway_bill');
  });

  it('defaults missing fields correctly', async () => {
    const parsed = await createInvoiceSchema.parseAsync({});
    expect(parsed.docType).toBe('commercial_invoice');
    expect(parsed.currency).toBe('USD');
    expect(parsed.incoterm).toBe('FOB');
    expect(parsed.discountType).toBe('amount');
    expect(parsed.discountValue).toBe(0);
    expect(parsed.taxRate).toBe(0);
  });
});

describe('createInvoiceSchema — invalid payloads', () => {
  it('rejects unknown docType', async () => {
    await expect(createInvoiceSchema.parseAsync({ docType: 'fake_invoice' })).rejects.toThrow();
  });

  it('rejects item with zero quantity', async () => {
    await expect(
      createInvoiceSchema.parseAsync({ items: [{ quantity: 0, unitPrice: 10 }] })
    ).rejects.toThrow();
  });

  it('rejects item with negative unitPrice', async () => {
    await expect(
      createInvoiceSchema.parseAsync({ items: [{ quantity: 1, unitPrice: -5 }] })
    ).rejects.toThrow();
  });

  it('rejects discountPercent > 100', async () => {
    await expect(
      createInvoiceSchema.parseAsync({
        items: [{ quantity: 1, unitPrice: 10, discountPercent: 110 }],
      })
    ).rejects.toThrow();
  });
});

describe('recordPaymentSchema', () => {
  it('accepts valid payment', async () => {
    const parsed = await recordPaymentSchema.parseAsync({ amount: 500.00, paymentMethod: 'Wire Transfer' });
    expect(parsed.amount).toBe(500.00);
  });

  it('rejects negative amount', async () => {
    await expect(recordPaymentSchema.parseAsync({ amount: -100 })).rejects.toThrow(/greater than zero/);
  });

  it('rejects zero amount', async () => {
    await expect(recordPaymentSchema.parseAsync({ amount: 0 })).rejects.toThrow(/greater than zero/);
  });

  it('defaults paymentMethod to Wire Transfer', async () => {
    const parsed = await recordPaymentSchema.parseAsync({ amount: 100 });
    expect(parsed.paymentMethod).toBe('Wire Transfer');
  });
});

describe('voidInvoiceSchema', () => {
  it('accepts a valid reason', async () => {
    const parsed = await voidInvoiceSchema.parseAsync({ reason: 'Duplicate invoice' });
    expect(parsed.reason).toBe('Duplicate invoice');
  });

  it('rejects reason shorter than 3 chars', async () => {
    await expect(voidInvoiceSchema.parseAsync({ reason: 'no' })).rejects.toThrow(/minimum 3 characters/);
  });

  it('rejects missing reason', async () => {
    await expect(voidInvoiceSchema.parseAsync({})).rejects.toThrow();
  });
});

describe('updateInvoiceSchema', () => {
  it('allows partial update (all fields optional)', async () => {
    const parsed = await updateInvoiceSchema.parseAsync({ notes: 'Updated note' });
    expect(parsed.notes).toBe('Updated note');
  });

  it('restricts status to draft or sent only', async () => {
    await expect(updateInvoiceSchema.parseAsync({ status: 'paid' })).rejects.toThrow();
    await expect(updateInvoiceSchema.parseAsync({ status: 'void' })).rejects.toThrow();
    const parsed = await updateInvoiceSchema.parseAsync({ status: 'sent' });
    expect(parsed.status).toBe('sent');
  });
});

describe('sanitizeMongoInput middleware', () => {
  const buildReq = () => ({
    body: {
      docType: 'commercial_invoice',
      $where: 'sleep(5000)',
      nested: {
        'operator.injection': true,
        $gt: 50,
        safeField: 'valid text',
      },
    },
    params: { id: '507f1f77bcf86cd799439011' },
    query: { $regex: '.*', search: 'hammer' },
  });

  it('calls next()', () => {
    const req = buildReq();
    let called = false;
    sanitizeMongoInput(req, {}, () => { called = true; });
    expect(called).toBe(true);
  });

  it('strips $ keys from body', () => {
    const req = buildReq();
    sanitizeMongoInput(req, {}, () => {});
    expect(req.body.$where).toBeUndefined();
    expect(req.body.nested.$gt).toBeUndefined();
  });

  it('strips dot-prefixed keys from body', () => {
    const req = buildReq();
    sanitizeMongoInput(req, {}, () => {});
    expect(req.body.nested['operator.injection']).toBeUndefined();
  });

  it('preserves safe fields', () => {
    const req = buildReq();
    sanitizeMongoInput(req, {}, () => {});
    expect(req.body.docType).toBe('commercial_invoice');
    expect(req.body.nested.safeField).toBe('valid text');
    expect(req.query.search).toBe('hammer');
  });

  it('strips $ keys from query params', () => {
    const req = buildReq();
    sanitizeMongoInput(req, {}, () => {});
    expect(req.query.$regex).toBeUndefined();
  });
});
