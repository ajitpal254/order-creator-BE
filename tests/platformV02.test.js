/**
 * platformV02.test.js
 * v0.2 platform workstream:
 * - SEC-12: order numbers come from an atomic Counter (same format as
 *   the old random generator), concurrent draws never repeat, and a
 *   duplicate-key on save retries with the next counter value.
 * - SEC-13: the shared body parsers cap JSON at 100kb (413 over the
 *   limit) while multipart uploads (multer) are unaffected.
 * - QOL-07: the indexes the list/query patterns need exist on the
 *   Order / Invoice / Product / User schemas.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser, DEFAULT_BODY_LIMIT } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import { upload } from '../src/middleware/upload.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import { Counter } from '../src/models/Counter.js';
import { Order } from '../src/models/Order.js';
import { Invoice } from '../src/models/Invoice.js';
import { Product } from '../src/models/Product.js';
import { User } from '../src/models/User.js';
import { generateOrderNumber, generatePaymentId } from '../src/utils/idGenerator.js';
import { generateAccessToken } from '../src/utils/token.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/orders', orderRoutes);
  // Bare multer endpoint to prove multipart bodies bypass the JSON limit.
  app.post('/test-upload', upload.single('image'), (req, res) => {
    res.status(200).json({ success: true, file: req.file?.filename || null });
  });
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Platform Buyer',
  businessName: 'Platform Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `plat_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `plat_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'supersecretpassword1',
  role: 'user',
  ...overrides,
});

let mongod;
let app;
let buyer;
let buyerToken;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([Counter.init(), Order.init(), User.init(), Product.init(), Invoice.init()]);
  app = buildTestApp();
  buyer = await User.create(makeUser());
  buyerToken = generateAccessToken(buyer);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await Order.deleteMany({});
  await Counter.deleteMany({});
});

const postDraftOrder = (orderType = 'Order') =>
  request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      items: [{ productName: 'Test Hammer', sku: 'TST-HMR-001', quantity: 2, unitPrice: 10 }],
      status: 'Draft',
      orderType,
    });

// ── SEC-12: atomic counter IDs ─────────────────────────────────────────────
describe('SEC-12 — Counter model', () => {
  it('increments sequentially per named sequence', async () => {
    expect(await Counter.nextSequence('test:seq')).toBe(1);
    expect(await Counter.nextSequence('test:seq')).toBe(2);
    expect(await Counter.nextSequence('test:other')).toBe(1);
  });

  it('never repeats a value under concurrent draws', async () => {
    const values = await Promise.all(Array.from({ length: 20 }, () => Counter.nextSequence('test:race')));
    expect(new Set(values).size).toBe(20);
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

describe('SEC-12 — order number generation', () => {
  it('keeps the exact HAO/RFQ format and increments the trailing segment', async () => {
    const year = new Date().getFullYear();
    const first = await generateOrderNumber('Order');
    const second = await generateOrderNumber('Order');
    const quote = await generateOrderNumber('Quote');
    expect(first).toBe(`HAO-${year}-100000`);
    expect(second).toBe(`HAO-${year}-100001`);
    expect(quote).toBe(`RFQ-${year}-100000`);
    expect(first).toMatch(/^HAO-\d{4}-\d{6}$/);
    expect(quote).toMatch(/^RFQ-\d{4}-\d{6}$/);
  });

  it('payment ID helper keeps the PAY-<epoch ms>-<digits> format', async () => {
    const paymentId = await generatePaymentId();
    expect(paymentId).toMatch(/^PAY-\d{13}-\d{3}$/);
  });

  it('creating two orders yields consecutive, unique order numbers', async () => {
    const res1 = await postDraftOrder();
    const res2 = await postDraftOrder();
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    const year = new Date().getFullYear();
    expect(res1.body.order.orderNumber).toBe(`HAO-${year}-100000`);
    expect(res2.body.order.orderNumber).toBe(`HAO-${year}-100001`);
  });

  it('retries with the next counter value when the drawn number already exists', async () => {
    const year = new Date().getFullYear();
    // Occupy the first slot with a "legacy" order (as the old random
    // generator could have), forcing a duplicate-key on the first draw.
    await Order.create({
      orderNumber: `HAO-${year}-100000`,
      orderType: 'Order',
      user: buyer._id,
      customerDetails: { customerName: 'Legacy', email: buyer.email },
      items: [{ productName: 'Legacy Hammer', sku: 'LEG-001', quantity: 1, unitPrice: 5, totalPrice: 5 }],
      totalQuantity: 1,
      totalAmount: 5,
      status: 'Draft',
    });

    const res = await postDraftOrder();
    expect(res.status).toBe(201);
    expect(res.body.order.orderNumber).toBe(`HAO-${year}-100001`);
  });

  it('orderNumber carries a unique index', () => {
    const uniqueOnOrderNumber = Order.schema.indexes().some(
      ([fields, opts]) => fields.orderNumber === 1 && opts.unique === true
    );
    expect(uniqueOnOrderNumber).toBe(true);
  });
});

// ── SEC-13: body size limits ───────────────────────────────────────────────
describe('SEC-13 — body size limits', () => {
  it('exposes a 100kb default limit', () => {
    expect(DEFAULT_BODY_LIMIT).toBe('100kb');
  });

  it('rejects a JSON body over 100kb with 413', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ padding: 'x'.repeat(150 * 1024) });
    expect(res.status).toBe(413);
  });

  it('accepts a normal small JSON body (not 413)', async () => {
    const res = await postDraftOrder();
    expect(res.status).toBe(201);
  });

  it('multipart uploads are not parsed (or limited) by the JSON parser', async () => {
    // 1x1 transparent PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=',
      'base64'
    );
    const res = await request(app).post('/test-upload').attach('image', png, 'pixel.png');
    expect(res.status).toBe(200);
    expect(res.body.file).toMatch(/^prod_.*\.png$/);
  });
});

// ── QOL-07: indexes ────────────────────────────────────────────────────────
describe('QOL-07 — schema indexes match query patterns', () => {
  const hasIndex = (Model, expected) =>
    Model.schema.indexes().some(([fields]) => JSON.stringify(fields) === JSON.stringify(expected));

  it('Order: user+createdAt (my-orders list), status+createdAt (admin list), user+status (draft/analytics)', () => {
    expect(hasIndex(Order, { user: 1, createdAt: -1 })).toBe(true);
    expect(hasIndex(Order, { status: 1, createdAt: -1 })).toBe(true);
    expect(hasIndex(Order, { user: 1, status: 1 })).toBe(true);
    expect(hasIndex(Order, { orderNumber: 1 })).toBe(true);
  });

  it('Invoice: invoiceNumber unique, user+createdAt (invoice list)', () => {
    expect(hasIndex(Invoice, { user: 1, createdAt: -1 })).toBe(true);
    const uniqueOnInvoiceNumber = Invoice.schema.indexes().some(
      ([fields, opts]) => fields.invoiceNumber === 1 && opts.unique === true
    );
    expect(uniqueOnInvoiceNumber).toBe(true);
  });

  it('Product: name, category, and isActive+createdAt / isActive+category+createdAt (catalog list)', () => {
    expect(hasIndex(Product, { name: 1 })).toBe(true);
    expect(hasIndex(Product, { category: 1 })).toBe(true);
    expect(hasIndex(Product, { isActive: 1, createdAt: -1 })).toBe(true);
    expect(hasIndex(Product, { isActive: 1, category: 1, createdAt: -1 })).toBe(true);
    expect(hasIndex(Product, { sku: 1 })).toBe(true);
  });

  it('User: email unique (login lookup) and role+createdAt (admin list)', () => {
    const uniqueOnEmail = User.schema.indexes().some(
      ([fields, opts]) => fields.email === 1 && opts.unique === true
    );
    expect(uniqueOnEmail).toBe(true);
    expect(hasIndex(User, { role: 1, createdAt: -1 })).toBe(true);
  });
});
