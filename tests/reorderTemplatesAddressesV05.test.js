/**
 * reorderTemplatesAddressesV05.test.js
 * v0.5 — workstream B3 (FEAT-05: reorder, templates, addresses):
 * - POST /api/orders/:id/reorder: owner gets a new Draft with identical
 *   items/totals/currency and a fresh orderNumber; another buyer -> 404;
 *   staff may reorder, and the Draft belongs to the source order's owner.
 * - /api/templates: owner-scoped CRUD-lite + fromOrderId snapshot +
 *   create-order producing a Draft with the template's items.
 * - /api/addresses: full owner-scoped CRUD; cross-user -> 404.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import express from 'express';
import cookieParser from 'cookie-parser';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import templateRoutes from '../src/routes/templateRoutes.js';
import addressRoutes from '../src/routes/addressRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { OrderTemplate } from '../src/models/OrderTemplate.js';
import { Address } from '../src/models/Address.js';
import { Counter } from '../src/models/Counter.js';
import { generateAccessToken } from '../src/utils/token.js';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/orders', orderRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/addresses', addressRoutes);
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
const SOURCE_ITEMS = [
  {
    productName: 'Test Hammer',
    sku: 'TST-HMR-001',
    size: 'Large',
    quantity: 10,
    unitPrice: 5,
    totalPrice: 50,
    snapshot: { basePrice: 5.5, weightKg: 1.2, pcsPerCarton: 20, tierDiscountPercent: 10 },
  },
  {
    productName: 'Test Wrench',
    sku: 'TST-WRN-002',
    quantity: 14,
    unitPrice: 5,
    totalPrice: 70,
  },
];
const makeOrder = (owner, status = 'Submitted', overrides = {}) => ({
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
  items: SOURCE_ITEMS,
  totalQuantity: 24,
  subtotalAmount: 120,
  discountPercent: 10,
  discountAmount: 12,
  totalAmount: 108,
  currency: 'EUR',
  currencyRate: 0.92,
  incoterm: 'CIF',
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
  // Generous hook timeout: bcryptjs password hashing in User.create is
  // slow on CPU-throttled runners and would otherwise blow the 10s
  // default hook timeout before the first test runs.
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 60000);

beforeEach(async () => {
  await Order.deleteMany({});
  await OrderTemplate.deleteMany({});
  await Address.deleteMany({});
  await Counter.deleteMany({});
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// ── Reorder ──────────────────────────────────────────────────────────────────
describe('FEAT-05 — POST /api/orders/:id/reorder', () => {
  it('owner reorders own order: new Draft, identical items/totals, different orderNumber', async () => {
    const source = await Order.create(makeOrder(owner));

    const res = await request(app)
      .post(`/api/orders/${source._id}/reorder`)
      .set(auth(ownerToken));

    expect(res.status).toBe(201);
    const created = res.body.data;
    expect(created).toBeTruthy();
    expect(created._id).not.toBe(source._id.toString());
    expect(created.orderNumber).not.toBe(source.orderNumber);
    expect(created.orderNumber).toMatch(/^HAO-\d{4}-\d{6}$/);
    expect(created.status).toBe('Draft');
    expect(created.orderType).toBe('Order');
    expect(created.user.toString()).toBe(owner._id.toString());
    expect(created.currency).toBe('EUR');
    expect(created.totalQuantity).toBe(24);
    expect(created.subtotalAmount).toBe(120);
    expect(created.discountAmount).toBe(12);
    expect(created.totalAmount).toBe(108);
    expect(created.items).toHaveLength(2);
    expect(created.items[0].productName).toBe('Test Hammer');
    expect(created.items[0].quantity).toBe(10);
    expect(created.items[0].unitPrice).toBe(5);
    expect(created.items[0].totalPrice).toBe(50);
    expect(created.items[0].snapshot.basePrice).toBe(5.5);
    expect(created.items[1].sku).toBe('TST-WRN-002');
    // No invoice side effects on a Draft.
    expect(created.invoice?.invoiceId ?? null).toBeNull();

    // Persisted as a real Draft, distinct document from the source.
    const inDb = await Order.findById(created._id);
    expect(inDb.status).toBe('Draft');
    expect(await Order.countDocuments({})).toBe(2);
  });

  it("another buyer gets 404 and no new order is created", async () => {
    const source = await Order.create(makeOrder(owner));

    const res = await request(app)
      .post(`/api/orders/${source._id}/reorder`)
      .set(auth(otherToken));

    expect(res.status).toBe(404);
    expect(await Order.countDocuments({})).toBe(1);
  });

  it('staff can reorder any order; the Draft belongs to the source owner', async () => {
    const source = await Order.create(makeOrder(owner));

    const res = await request(app)
      .post(`/api/orders/${source._id}/reorder`)
      .set(auth(adminToken));

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('Draft');
    expect(res.body.data.user.toString()).toBe(owner._id.toString());
  });

  it('returns 404 for a nonexistent order', async () => {
    const res = await request(app)
      .post(`/api/orders/${new mongoose.Types.ObjectId()}/reorder`)
      .set(auth(ownerToken));
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const source = await Order.create(makeOrder(owner));
    const res = await request(app).post(`/api/orders/${source._id}/reorder`);
    expect(res.status).toBe(401);
  });
});

// ── Templates ────────────────────────────────────────────────────────────────
describe('FEAT-05 — /api/templates', () => {
  const templateItems = [
    { productName: 'Template Hammer', sku: 'TPL-HMR-001', quantity: 4, unitPrice: 7.5, totalPrice: 30 },
    { productName: 'Template Saw', sku: 'TPL-SAW-002', quantity: 2, unitPrice: 10, totalPrice: 20 },
  ];

  it('creates a template from explicit items (201)', async () => {
    const res = await request(app)
      .post('/api/templates')
      .set(auth(ownerToken))
      .send({ name: 'Monthly Restock', items: templateItems });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Monthly Restock');
    expect(res.body.data.user.toString()).toBe(owner._id.toString());
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0].totalPrice).toBe(30);
  });

  it('creates a template by snapshotting an own order (fromOrderId)', async () => {
    const source = await Order.create(makeOrder(owner));

    const res = await request(app)
      .post('/api/templates')
      .set(auth(ownerToken))
      .send({ name: 'From Order', fromOrderId: source._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0].sku).toBe('TST-HMR-001');
    expect(res.body.data.items[0].totalPrice).toBe(50);
    expect(res.body.data.items[0].snapshot.basePrice).toBe(5.5);
  });

  it("returns 404 when fromOrderId is another user's order", async () => {
    const othersOrder = await Order.create(makeOrder(otherBuyer));

    const res = await request(app)
      .post('/api/templates')
      .set(auth(ownerToken))
      .send({ name: 'Stolen Snapshot', fromOrderId: othersOrder._id.toString() });

    expect(res.status).toBe(404);
    expect(await OrderTemplate.countDocuments({ user: owner._id })).toBe(0);
  });

  it('list returns only own templates in the paginated envelope', async () => {
    await OrderTemplate.create({ user: owner._id, name: 'Mine', items: templateItems });
    await OrderTemplate.create({ user: otherBuyer._id, name: 'Theirs', items: templateItems });

    const res = await request(app).get('/api/templates').set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.count).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.data[0].name).toBe('Mine');
  });

  it('deletes own template; another user gets 404 and the template survives', async () => {
    const mine = await OrderTemplate.create({ user: owner._id, name: 'Mine', items: templateItems });

    const forbidden = await request(app)
      .delete(`/api/templates/${mine._id}`)
      .set(auth(otherToken));
    expect(forbidden.status).toBe(404);
    expect(await OrderTemplate.findById(mine._id)).not.toBeNull();

    const res = await request(app).delete(`/api/templates/${mine._id}`).set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(await OrderTemplate.findById(mine._id)).toBeNull();
  });

  it('create-order produces a Draft with the template items and summed totals', async () => {
    const template = await OrderTemplate.create({
      user: owner._id,
      name: 'Restock',
      items: templateItems,
    });

    const res = await request(app)
      .post(`/api/templates/${template._id}/create-order`)
      .set(auth(ownerToken));

    expect(res.status).toBe(201);
    const order = res.body.data;
    expect(order.status).toBe('Draft');
    expect(order.user.toString()).toBe(owner._id.toString());
    expect(order.orderNumber).toMatch(/^HAO-\d{4}-\d{6}$/);
    expect(order.items).toHaveLength(2);
    expect(order.items[0].sku).toBe('TPL-HMR-001');
    expect(order.items[0].totalPrice).toBe(30);
    expect(order.totalQuantity).toBe(6);
    expect(order.totalAmount).toBe(50);
    expect(order.invoice?.invoiceId ?? null).toBeNull();
  });

  it("create-order on another user's template returns 404", async () => {
    const theirs = await OrderTemplate.create({
      user: otherBuyer._id,
      name: 'Theirs',
      items: templateItems,
    });

    const res = await request(app)
      .post(`/api/templates/${theirs._id}/create-order`)
      .set(auth(ownerToken));

    expect(res.status).toBe(404);
    expect(await Order.countDocuments({})).toBe(0);
  });
});

// ── Addresses ────────────────────────────────────────────────────────────────
describe('FEAT-05 — /api/addresses CRUD', () => {
  const addressBody = {
    label: 'HQ Warehouse',
    type: 'ship-to',
    line1: '42 Export Way',
    line2: 'Unit 7',
    city: 'Toronto',
    state: 'ON',
    country: 'Canada',
    postalCode: 'M5V 1J1',
  };

  const createOwnAddress = async () => {
    const res = await request(app)
      .post('/api/addresses')
      .set(auth(ownerToken))
      .send(addressBody);
    expect(res.status).toBe(201);
    return res.body.data;
  };

  it('creates an address (201) with defaults applied', async () => {
    const res = await request(app)
      .post('/api/addresses')
      .set(auth(ownerToken))
      .send({ line1: '1 Minimal St' });

    expect(res.status).toBe(201);
    expect(res.body.data.line1).toBe('1 Minimal St');
    expect(res.body.data.type).toBe('ship-to');
    expect(res.body.data.user.toString()).toBe(owner._id.toString());
  });

  it('lists only own addresses in the paginated envelope', async () => {
    await createOwnAddress();
    await Address.create({ user: otherBuyer._id, line1: '9 Other Rd', type: 'bill-to' });

    const res = await request(app).get('/api/addresses').set(auth(ownerToken));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].line1).toBe('42 Export Way');
  });

  it('reads own address; another user gets 404', async () => {
    const created = await createOwnAddress();

    const own = await request(app).get(`/api/addresses/${created._id}`).set(auth(ownerToken));
    expect(own.status).toBe(200);
    expect(own.body.data.city).toBe('Toronto');

    const other = await request(app).get(`/api/addresses/${created._id}`).set(auth(otherToken));
    expect(other.status).toBe(404);
  });

  it('updates own address; another user gets 404 and nothing changes', async () => {
    const created = await createOwnAddress();

    const other = await request(app)
      .put(`/api/addresses/${created._id}`)
      .set(auth(otherToken))
      .send({ city: 'Hacked City' });
    expect(other.status).toBe(404);
    expect((await Address.findById(created._id)).city).toBe('Toronto');

    const res = await request(app)
      .put(`/api/addresses/${created._id}`)
      .set(auth(ownerToken))
      .send({ city: 'Ottawa', label: 'Main Office' });
    expect(res.status).toBe(200);
    expect(res.body.data.city).toBe('Ottawa');
    expect(res.body.data.label).toBe('Main Office');
    expect(res.body.data.line1).toBe('42 Export Way');
  });

  it('deletes own address; another user gets 404 and the address survives', async () => {
    const created = await createOwnAddress();

    const other = await request(app)
      .delete(`/api/addresses/${created._id}`)
      .set(auth(otherToken));
    expect(other.status).toBe(404);
    expect(await Address.findById(created._id)).not.toBeNull();

    const res = await request(app)
      .delete(`/api/addresses/${created._id}`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(await Address.findById(created._id)).toBeNull();
  });

  it('rejects an invalid address type (400)', async () => {
    const res = await request(app)
      .post('/api/addresses')
      .set(auth(ownerToken))
      .send({ line1: '1 Bad Type St', type: 'home' });
    expect(res.status).toBe(400);
  });
});
