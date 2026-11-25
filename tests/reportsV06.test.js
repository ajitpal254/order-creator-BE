/**
 * reportsV06.test.js
 * FEAT-07 (v0.6) — admin reports (B3), all read-only:
 * - GET /api/reports/revenue (buyer / product / country groupings, date
 *   filter, Draft+Cancelled excluded, stored totals used as-is, CSV form)
 * - GET /api/reports/receivables-ageing (sent/partial/overdue invoices with
 *   balanceDue > 0 bucketed by dueDate age)
 * - GET /api/reports/backlog (open orders by status + oldest open order)
 * - Every route: buyer token -> 403, no token -> 401.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import reportRoutes from '../src/routes/reportRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Invoice } from '../src/models/Invoice.js';
import { generateAccessToken } from '../src/utils/token.js';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/reports', reportRoutes);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });
  return app;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY_MS);

const makeUser = (overrides = {}) => ({
  customerName: 'Report Buyer',
  businessName: 'Report Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `rep_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `rep_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'Password123!',
  role: 'user',
  ...overrides,
});

let orderSeq = 0;
const makeOrder = (owner, status, overrides = {}) => ({
  orderNumber: `HAO-REP-${++orderSeq}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  orderType: 'Order',
  user: owner._id,
  customerDetails: {
    customerName: owner.customerName,
    businessName: owner.businessName,
    country: owner.country,
    phoneNumber: owner.phoneNumber,
    address: owner.address,
    email: owner.email,
  },
  items: [{ productName: 'Test Hammer', sku: 'TST-HMR-001', quantity: 1, unitPrice: 50, totalPrice: 50 }],
  totalQuantity: 1,
  subtotalAmount: 50,
  totalAmount: 50,
  currency: 'USD',
  incoterm: 'FOB',
  status,
  ...overrides,
});

let invoiceSeq = 0;
const makeInvoice = (owner, overrides = {}) => ({
  invoiceNumber: `INV-REP-${++invoiceSeq}`,
  user: owner._id,
  customerDetails: { customerName: owner.customerName, email: owner.email },
  status: 'sent',
  currency: 'USD',
  grandTotal: 100,
  amountPaid: 0,
  balanceDue: 100,
  dueDate: daysFromNow(10),
  ...overrides,
});

let mongod;
let app;
let admin, buyer1, buyer2;
let adminToken, buyerToken;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
  admin = await User.create(makeUser({ customerName: 'Report Admin', role: 'admin' }));
  buyer1 = await User.create(makeUser({ customerName: 'Buyer One', country: 'Canada' }));
  buyer2 = await User.create(makeUser({ customerName: 'Buyer Two', country: 'Germany' }));
  adminToken = generateAccessToken(admin);
  buyerToken = generateAccessToken(buyer1);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

const setCreatedAt = async (doc, date) => {
  // Raw collection write: Mongoose timestamp handling on updateOne
  // rewrites createdAt, which would defeat the backdating.
  await Order.collection.updateOne({ _id: doc._id }, { $set: { createdAt: date } });
};

let draftOrder;
beforeEach(async () => {
  await Order.deleteMany({});
  await Invoice.deleteMany({});

  // buyer1 — Canada, USD
  await Order.create(
    makeOrder(buyer1, 'Confirmed', {
      totalAmount: 100,
      items: [
        { productName: 'Hammer', sku: 'HMR-1', quantity: 2, unitPrice: 30, totalPrice: 60 },
        { productName: 'Wrench', sku: 'WRN-1', quantity: 1, unitPrice: 40, totalPrice: 40 },
      ],
    })
  );
  await Order.create(
    makeOrder(buyer1, 'Shipped', {
      totalAmount: 50,
      items: [{ productName: 'Hammer', sku: 'HMR-1', quantity: 1, unitPrice: 50, totalPrice: 50 }],
    })
  );
  draftOrder = await Order.create(makeOrder(buyer1, 'Draft', { totalAmount: 999 }));
  await setCreatedAt(draftOrder, daysFromNow(-200)); // oldest open order
  await Order.create(makeOrder(buyer1, 'Cancelled', { totalAmount: 888 }));
  await Order.create(makeOrder(buyer1, 'Delivered', { totalAmount: 555 }));

  // buyer2 — Germany
  const oldEurOrder = await Order.create(
    makeOrder(buyer2, 'Confirmed', {
      totalAmount: 200,
      currency: 'EUR',
      items: [{ productName: 'Wrench', sku: 'WRN-1', quantity: 5, unitPrice: 40, totalPrice: 200 }],
    })
  );
  await setCreatedAt(oldEurOrder, daysFromNow(-100)); // outside the 30-day window
  await Order.create(makeOrder(buyer2, 'Submitted', { totalAmount: 70, currency: 'USD' }));

  // Invoices — one per ageing bucket, plus three that must be excluded.
  await Invoice.create(makeInvoice(buyer1, { balanceDue: 100, dueDate: daysFromNow(10), status: 'sent' }));
  await Invoice.create(makeInvoice(buyer1, { balanceDue: 200, dueDate: daysFromNow(-10), status: 'partial' }));
  await Invoice.create(makeInvoice(buyer1, { balanceDue: 300, dueDate: daysFromNow(-45), status: 'overdue' }));
  await Invoice.create(makeInvoice(buyer2, { balanceDue: 400, dueDate: daysFromNow(-75), status: 'sent' }));
  await Invoice.create(makeInvoice(buyer2, { balanceDue: 500, dueDate: daysFromNow(-120), status: 'overdue' }));
  await Invoice.create(makeInvoice(buyer1, { balanceDue: 999, dueDate: daysFromNow(-10), status: 'paid' }));
  await Invoice.create(makeInvoice(buyer1, { balanceDue: 0, dueDate: daysFromNow(-10), status: 'sent' }));
  await Invoice.create(makeInvoice(buyer1, { balanceDue: 777, dueDate: daysFromNow(-10), status: 'draft' }));
});

// ── Revenue ─────────────────────────────────────────────────────────────────
describe('FEAT-07 — GET /api/reports/revenue', () => {
  it('buyer grouping sums stored totals, splits currencies, excludes Draft/Cancelled', async () => {
    const res = await request(app)
      .get('/api/reports/revenue?groupBy=buyer')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const rows = res.body.data;
    const b1 = rows.find((r) => r.key === String(buyer1._id) && r.currency === 'USD');
    expect(b1.orders).toBe(3); // Confirmed + Shipped + Delivered (Draft/Cancelled excluded)
    expect(b1.total).toBe(705);
    expect(b1.label).toContain('Buyer One');
    expect(b1.label).toContain(buyer1.email);
    const b2eur = rows.find((r) => r.key === String(buyer2._id) && r.currency === 'EUR');
    expect(b2eur.orders).toBe(1);
    expect(b2eur.total).toBe(200);
    const b2usd = rows.find((r) => r.key === String(buyer2._id) && r.currency === 'USD');
    expect(b2usd.orders).toBe(1);
    expect(b2usd.total).toBe(70);
    // sorted by total desc
    expect(rows[0].total).toBe(705);
  });

  it('defaults to buyer grouping and uses the paginated envelope', async () => {
    const res = await request(app)
      .get('/api/reports/revenue')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.count).toBe(3);
    expect(res.body.page).toBe(1);
  });

  it('product grouping uses stored item line totals and distinct order counts', async () => {
    const res = await request(app)
      .get('/api/reports/revenue?groupBy=product')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = res.body.data;
    const hammer = rows.find((r) => r.label === 'Hammer' && r.currency === 'USD');
    expect(hammer.total).toBe(110); // 60 + 50 across two orders
    expect(hammer.orders).toBe(2);
    const wrenchUsd = rows.find((r) => r.label === 'Wrench' && r.currency === 'USD');
    expect(wrenchUsd.total).toBe(40);
    expect(wrenchUsd.orders).toBe(1);
    const wrenchEur = rows.find((r) => r.label === 'Wrench' && r.currency === 'EUR');
    expect(wrenchEur.total).toBe(200);
    expect(wrenchEur.orders).toBe(1);
  });

  it('country grouping uses the order destination country snapshot', async () => {
    const res = await request(app)
      .get('/api/reports/revenue?groupBy=country')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = res.body.data;
    const canada = rows.find((r) => r.key === 'Canada' && r.currency === 'USD');
    expect(canada.orders).toBe(3);
    expect(canada.total).toBe(705);
    const germanyEur = rows.find((r) => r.key === 'Germany' && r.currency === 'EUR');
    expect(germanyEur.total).toBe(200);
  });

  it('date filter on createdAt excludes orders outside the window', async () => {
    const from = daysFromNow(-30).toISOString();
    const res = await request(app)
      .get(`/api/reports/revenue?groupBy=buyer&from=${encodeURIComponent(from)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = res.body.data;
    // buyer2's EUR order is 100 days old — gone; the recent USD order stays.
    expect(rows.find((r) => r.key === String(buyer2._id) && r.currency === 'EUR')).toBeUndefined();
    const b2usd = rows.find((r) => r.key === String(buyer2._id) && r.currency === 'USD');
    expect(b2usd.total).toBe(70);
  });

  it('rejects an unknown groupBy with 400', async () => {
    const res = await request(app)
      .get('/api/reports/revenue?groupBy=planet')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('CSV form returns text/csv with the header row and all rows', async () => {
    const res = await request(app)
      .get('/api/reports/revenue?groupBy=buyer&format=csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('key,label,orders,total,currency');
    expect(lines).toHaveLength(4); // header + 3 (buyer, currency) rows
    expect(res.text).toContain('705');
  });
});

// ── Receivables ageing ──────────────────────────────────────────────────────
describe('FEAT-07 — GET /api/reports/receivables-ageing', () => {
  it('buckets outstanding invoices by dueDate age and sums balanceDue', async () => {
    const res = await request(app)
      .get('/api/reports/receivables-ageing')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { buckets, totalOutstanding } = res.body.data;
    const byName = Object.fromEntries(buckets.map((b) => [b.bucket, b]));
    expect(byName.current).toMatchObject({ count: 1, total: 100 });
    expect(byName['1-30']).toMatchObject({ count: 1, total: 200 });
    expect(byName['31-60']).toMatchObject({ count: 1, total: 300 });
    expect(byName['61-90']).toMatchObject({ count: 1, total: 400 });
    expect(byName['90+']).toMatchObject({ count: 1, total: 500 });
    // paid (999), zero-balance (0) and draft (777) invoices are excluded
    expect(totalOutstanding).toBe(1500);
  });

  it('CSV form returns bucket,count,total rows', async () => {
    const res = await request(app)
      .get('/api/reports/receivables-ageing?format=csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('bucket,count,total');
    expect(lines).toContain('90+,1,500');
    expect(lines).toContain('current,1,100');
  });
});

// ── Backlog ─────────────────────────────────────────────────────────────────
describe('FEAT-07 — GET /api/reports/backlog', () => {
  it('groups open orders by status and finds the oldest open order', async () => {
    const res = await request(app)
      .get('/api/reports/backlog')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { byStatus, oldestOpenOrder } = res.body.data;
    const byName = Object.fromEntries(byStatus.map((s) => [s.status, s]));
    expect(byName.Confirmed).toMatchObject({ count: 2, totalValue: 300 });
    expect(byName.Shipped).toMatchObject({ count: 1, totalValue: 50 });
    expect(byName.Submitted).toMatchObject({ count: 1, totalValue: 70 });
    expect(byName.Draft).toMatchObject({ count: 1, totalValue: 999 });
    expect(byName.Delivered).toBeUndefined();
    expect(byName.Cancelled).toBeUndefined();
    expect(oldestOpenOrder.orderNumber).toBe(draftOrder.orderNumber);
    expect(oldestOpenOrder.ageDays).toBe(200);
  });
});

// ── Auth guards ─────────────────────────────────────────────────────────────
describe('FEAT-07 — auth guards on all report routes', () => {
  const paths = ['/api/reports/revenue', '/api/reports/receivables-ageing', '/api/reports/backlog'];

  it.each(paths)('buyer token -> 403 on %s', async (path) => {
    const res = await request(app).get(path).set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  it.each(paths)('no token -> 401 on %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });
});
