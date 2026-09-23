import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInvoiceSchema,
  recordPaymentSchema,
  voidInvoiceSchema,
} from '../src/middleware/validate.js';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';

test('Invoice Validation: Validates and parses compliant invoice creation payload', async () => {
  const validPayload = {
    docType: 'commercial_invoice',
    currency: 'USD',
    incoterm: 'FOB',
    customerDetails: {
      customerName: 'Acme International',
      businessName: 'Acme Hardware Ltd',
      country: 'Canada',
    },
    items: [
      {
        productName: 'Professional Ball Pein Hammer',
        quantity: 50,
        unitPrice: 4.5,
      },
    ],
  };

  const parsed = await createInvoiceSchema.parseAsync(validPayload);
  assert.equal(parsed.customerDetails.customerName, 'Acme International');
  assert.equal(parsed.items[0].quantity, 50);
  assert.equal(parsed.items[0].unitPrice, 4.5);
});

test('Invoice Validation: Rejects invalid payment payloads', async () => {
  // Negative amount
  await assert.rejects(
    async () => {
      await recordPaymentSchema.parseAsync({ amount: -100 });
    },
    /Payment amount must be greater than zero/
  );

  // Zero amount
  await assert.rejects(
    async () => {
      await recordPaymentSchema.parseAsync({ amount: 0 });
    },
    /Payment amount must be greater than zero/
  );
});

test('Invoice Validation: Rejects void request without reason', async () => {
  await assert.rejects(
    async () => {
      await voidInvoiceSchema.parseAsync({ reason: 'no' }); // less than 3 chars
    },
    /minimum 3 characters/
  );
});

test('Security: MongoDB input sanitizer removes $ and dot operators', () => {
  const req = {
    body: {
      docType: 'commercial_invoice',
      $where: 'sleep(5000)',
      nested: {
        'operator.injection': true,
        $gt: 50,
        safeField: 'valid text',
      },
    },
    params: {
      id: '507f1f77bcf86cd799439011',
    },
    query: {
      $regex: '.*',
      search: 'hammer',
    },
  };

  let nextCalled = false;
  sanitizeMongoInput(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.body.$where, undefined);
  assert.equal(req.body.nested.$gt, undefined);
  assert.equal(req.body.nested['operator.injection'], undefined);
  assert.equal(req.body.nested.safeField, 'valid text');
  assert.equal(req.query.$regex, undefined);
  assert.equal(req.query.search, 'hammer');
});
