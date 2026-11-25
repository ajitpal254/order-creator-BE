/**
 * ordersInput.test.js
 * v0.1 security hotfix — workstream 2 (orders & input):
 * - SEC-01: PATCH /api/orders/:id/status must enforce ownership for
 *   non-staff users (404 for another buyer's order, status unchanged),
 *   while owners and staff keep working.
 * - SEC-06: user-supplied search strings are escaped before being compiled
 *   into RegExps (metacharacters match literally, never match-all, never
 *   throw), truncated to 64 chars, and list pagination is capped
 *   (limit <= 100, page >= 1).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import express from 'express';
import cookieParser from 'cookie-parser';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import productRoutes from '../src/routes/productRoutes.js';
import invoiceRoutes from '../src/routes/invoiceRoutes.js';
import userRoutes from '../src/routes/userRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { Invoice } from '../src/models/Invoice.js';
import { generateAccessToken } from '../src/utils/token.js';
import { escapeRegExp, createSearchRegex, MAX_SEARCH_LENGTH } from '../src/utils/escapeRegExp.js';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/orders', orderRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/users', userRoutes);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Test Buyer',
  businessName: 'Test Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `testuser_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'Password123!',
  role: 'user',
  ...overrides,
});

let orderSeq = 0;
const makeOrder = (owner, status, overrides = {}) => ({
  orderNumber: `HAO-T-${++orderSeq}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  orderType: 'Order',
  user: owner._id,
  customerDetails: {
    customerName: owner.customerName,
    businessName: owner.businessName,
    country: 'Canada',
    phoneNumber: owner.phoneNumber,
    address: owner.address,
    email: owner.email,
  },
  items: [{ productName: 'Test Hammer', sku: 'TST-HMR-001', quantity: 10, unitPrice: 5, totalPrice: 50 }],
  totalQuantity: 10,
  subtotalAmount: 50,
  totalAmount: 50,
  currency: 'USD',
  incoterm: 'FOB',
  status,
  ...overrides,
});

let mongod;
let app;
let owner, otherBuyer, admin;
let ownerToken, otherToken, adminToken;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();

  owner = await User.create(makeUser({ customerName: 'Owner Buyer' }));
  otherBuyer = await User.create(makeUser({ customerName: 'Other Buyer' }));
  admin = await User.create(makeUser({ customerName: 'Admin User', role: 'admin' }));

  ownerToken = generateAccessToken(owner);
  otherToken = generateAccessToken(otherBuyer);
  adminToken = generateAccessToken(admin);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Order.deleteMany({});
  await Product.deleteMany({});
  await Invoice.deleteMany({});
});

const patchStatus = (token, orderId, body) =>
  request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

// ── SEC-01: ownership check on PATCH /api/orders/:id/status ──────────────────
describe('SEC-01 — updateOrderStatus ownership', () => {
  it('returns 404 and leaves status unchanged when another buyer tries Draft→Submitted', async () => {
    const order = await Order.create(makeOrder(owner, 'Draft'));

    const res = await patchStatus(otherToken, order._id, { status: 'Submitted' });

    expect(res.status).toBe(404);
    expect((await Order.findById(order._id)).status).toBe('Draft');
  });

  it('returns 404 and leaves status unchanged when another buyer tries Draft→Cancelled', async () => {
    const order = await Order.create(makeOrder(owner, 'Draft'));

    const res = await patchStatus(otherToken, order._id, {
      status: 'Cancelled',
      cancellationReason: 'Changed my mind',
    });

    expect(res.status).toBe(404);
    expect((await Order.findById(order._id)).status).toBe('Draft');
  });

  it('returns 404 and leaves status unchanged when another buyer tries Shipped→Delivered', async () => {
    const order = await Order.create(makeOrder(owner, 'Shipped'));

    const res = await patchStatus(otherToken, order._id, { status: 'Delivered' });

    expect(res.status).toBe(404);
    expect((await Order.findById(order._id)).status).toBe('Shipped');
  });

  it('lets the owning buyer transition their own Draft→Submitted', async () => {
    const order = await Order.create(makeOrder(owner, 'Draft'));

    const res = await patchStatus(ownerToken, order._id, { status: 'Submitted' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Submitted');
    expect((await Order.findById(order._id)).status).toBe('Submitted');
  });

  it('lets the owning buyer transition their own Draft→Cancelled', async () => {
    const order = await Order.create(makeOrder(owner, 'Draft'));

    const res = await patchStatus(ownerToken, order._id, {
      status: 'Cancelled',
      cancellationReason: 'No longer needed',
    });

    expect(res.status).toBe(200);
    expect((await Order.findById(order._id)).status).toBe('Cancelled');
  });

  it('lets the owning buyer transition their own Shipped→Delivered', async () => {
    const order = await Order.create(makeOrder(owner, 'Shipped'));

    const res = await patchStatus(ownerToken, order._id, { status: 'Delivered' });

    expect(res.status).toBe(200);
    expect((await Order.findById(order._id)).status).toBe('Delivered');
  });

  it('lets staff transition another user\'s order (Submitted→Confirmed)', async () => {
    const order = await Order.create(makeOrder(owner, 'Submitted'));

    const res = await patchStatus(adminToken, order._id, { status: 'Confirmed' });

    expect(res.status).toBe(200);
    expect((await Order.findById(order._id)).status).toBe('Confirmed');
  });
});

// ── SEC-06: escapeRegExp helper ──────────────────────────────────────────────
describe('SEC-06 — escapeRegExp helper', () => {
  it('escapes all regex metacharacters', () => {
    expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('createSearchRegex treats ".*" literally (no match-all)', () => {
    const re = createSearchRegex('.*');
    expect(re.test('anything at all')).toBe(false);
    expect(re.test('price is .* firm')).toBe(true);
  });

  it('createSearchRegex("(") does not throw and matches literally', () => {
    const re = createSearchRegex('(');
    expect(re.test('Bolt (M6)')).toBe(true);
    expect(re.test('Bolt M6')).toBe(false);
  });

  it('createSearchRegex truncates input to 64 characters', () => {
    const re = createSearchRegex('a'.repeat(100));
    expect(re.test('a'.repeat(MAX_SEARCH_LENGTH))).toBe(true);
    expect(re.source).toBe('a'.repeat(MAX_SEARCH_LENGTH));
  });
});

// ── SEC-06: product list search + pagination ─────────────────────────────────
describe('SEC-06 — GET /api/products search & pagination', () => {
  beforeEach(async () => {
    await Product.create({ name: 'Steel Hammer', sku: 'STL-HMR-001', category: 'Hand Tools' });
    await Product.create({ name: 'Bolt (M6) Pack', sku: 'BLT-M6-001', category: 'Fasteners' });
  });

  it('treats ".*" literally: no match-all', async () => {
    const res = await request(app).get('/api/products').query({ search: '.*' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.data).toHaveLength(0);
  });

  it('treats "(" literally: no 500 error', async () => {
    const res = await request(app).get('/api/products').query({ search: '(' });
    expect(res.status).toBe(200);
    // "(" appears literally in "Bolt (M6) Pack" only
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].name).toBe('Bolt (M6) Pack');
  });

  it('matches a literal substring containing metacharacters', async () => {
    const res = await request(app).get('/api/products').query({ search: '(M6' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].sku).toBe('BLT-M6-001');
  });

  it('truncates an over-long search string to 64 chars before matching', async () => {
    await Product.create({ name: 'a'.repeat(70), sku: 'AAA-001', category: 'Odd' });
    // 100 a's is NOT a substring of the 70-a name; truncated to 64 a's it is.
    const res = await request(app).get('/api/products').query({ search: 'a'.repeat(100) });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].sku).toBe('AAA-001');
  });

  it('caps limit at 100 even when a larger limit is requested', async () => {
    const bulk = Array.from({ length: 105 }, (_, i) => ({
      name: `Bulk Widget ${i}`,
      sku: `BULK-${String(i).padStart(3, '0')}`,
      category: 'Bulk',
    }));
    await Product.insertMany(bulk);

    const res = await request(app).get('/api/products').query({ limit: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(107);
    expect(res.body.data).toHaveLength(100);
  });

  it('floors page at 1', async () => {
    const res = await request(app).get('/api/products').query({ page: 0 });
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
  });
});

// ── SEC-06: order list search + pagination ───────────────────────────────────
describe('SEC-06 — GET /api/orders search & pagination', () => {
  beforeEach(async () => {
    await Order.create(makeOrder(owner, 'Submitted', { orderNumber: 'HAO-SRCH-001' }));
  });

  it('treats ".*" literally: no match-all', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ search: '.*' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.data).toHaveLength(0);
  });

  it('treats "(" literally: no 500 error, no matches', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ search: '(' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('still finds orders by a plain search term', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ search: 'HAO-SRCH' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('caps limit at 100', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });
});

// ── SEC-06: invoice list search ──────────────────────────────────────────────
describe('SEC-06 — GET /api/invoices search', () => {
  beforeEach(async () => {
    await Invoice.create({
      invoiceNumber: 'INV-SRCH-001',
      user: owner._id,
      customerDetails: { customerName: 'Search Buyer' },
      items: [{ productName: 'Hammer', quantity: 1, unitPrice: 10 }],
      status: 'sent',
    });
  });

  it('treats ".*" literally: no match-all', async () => {
    const res = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ search: '.*' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('treats "(" literally: no 500 error, no matches', async () => {
    const res = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ search: '(' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('still finds invoices by a plain search term', async () => {
    const res = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ search: 'INV-SRCH' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });
});

// ── SEC-06: user list search + pagination ────────────────────────────────────
describe('SEC-06 — GET /api/users search & pagination', () => {
  it('treats ".*" literally: no match-all', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ search: '.*' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.data).toHaveLength(0);
  });

  it('treats "(" literally: no 500 error', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ search: '(' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('keeps success/count/data and adds total/page/limit', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // owner + otherBuyer have role 'user'; admin is excluded by the role filter
    expect(res.body.total).toBe(2);
    expect(res.body.count).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(100);
    expect(res.body.data).toHaveLength(2);
  });

  it('caps limit at 100 and honours page/limit pagination', async () => {
    const capped = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 1000 });
    expect(capped.status).toBe(200);
    expect(capped.body.limit).toBe(100);

    const page2 = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 1, page: 2 });
    expect(page2.status).toBe(200);
    expect(page2.body.page).toBe(2);
    expect(page2.body.limit).toBe(1);
    expect(page2.body.total).toBe(2);
    expect(page2.body.count).toBe(1);
    expect(page2.body.data).toHaveLength(1);
  });
});
