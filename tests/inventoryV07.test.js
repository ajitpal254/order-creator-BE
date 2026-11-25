/**
 * inventoryV07.test.js
 * FEAT-09 (v0.7) — inventory, MOQ, lead times:
 * - Product model additive fields: leadTimeDays, stockQuantity,
 *   availabilityNote, priceBreaks (moq already existed).
 * - Admin create/update accept + validate the new fields (400 on
 *   negative leadTimeDays/stockQuantity and malformed priceBreaks);
 *   list + detail responses include them.
 * - priceBreaks are DATA ONLY: they must not change order totals.
 * - GET /api/orders/:id detail gains estimatedShipDate, computed at
 *   serialization time from the MAX product leadTimeDays +
 *   ORDER_LEAD_BUFFER_DAYS (read per call); never stored.
 * - REGRESSION: order totals through the normal API flow are exactly
 *   what the existing tier pricing rules produce.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import productRoutes from '../src/routes/productRoutes.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { Order } from '../src/models/Order.js';
import { generateAccessToken } from '../src/utils/token.js';
import { getTierDiscountPercent } from '../src/utils/pricing.js';
import { computeEstimatedShipDate } from '../src/utils/leadTime.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/products', productRoutes);
  app.use('/api/orders', orderRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Inventory Buyer',
  businessName: 'Inventory Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'testpassword123',
  role: 'user',
  ...overrides,
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const DAY_MS = 24 * 60 * 60 * 1000;

let mongod;
let app;
let admin, adminToken;
let buyer, buyerToken;
let goldBuyer, goldToken;
let skuSeq = 0;

const productPayload = (overrides = {}) => {
  skuSeq += 1;
  return {
    name: `Widget ${skuSeq}`,
    sku: `INV-WDG-${skuSeq}`,
    category: 'Hand Tools',
    basePrice: 20,
    ...overrides,
  };
};

const createProductViaApi = async (overrides = {}) => {
  const res = await request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send(productPayload(overrides));
  expect(res.status).toBe(201);
  return res.body.data;
};

const makeOrderDoc = async (owner, items, overrides = {}) =>
  Order.create({
    orderNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    user: owner._id,
    customerDetails: {
      customerName: owner.customerName,
      businessName: owner.businessName,
      country: owner.country,
      phoneNumber: owner.phoneNumber,
      address: owner.address,
      email: owner.email,
    },
    items,
    totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
    subtotalAmount: 100,
    totalAmount: 100,
    currency: 'USD',
    status: 'Submitted',
    ...overrides,
  });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
  admin = await User.create(makeUser({ role: 'admin' }));
  adminToken = generateAccessToken(admin);
  buyer = await User.create(makeUser());
  buyerToken = generateAccessToken(buyer);
  goldBuyer = await User.create(makeUser({ distributorTier: 'Gold' }));
  goldToken = generateAccessToken(goldBuyer);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await Product.deleteMany({});
  await Order.deleteMany({});
  delete process.env.ORDER_LEAD_BUFFER_DAYS;
});

afterEach(() => {
  delete process.env.ORDER_LEAD_BUFFER_DAYS;
});

// ── Product create / read ──────────────────────────────────────────────────
describe('FEAT-09 — product inventory fields', () => {
  it('admin creates a product with the new fields; create + detail + list show them', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send(
        productPayload({
          leadTimeDays: 25,
          stockQuantity: 400,
          availabilityNote: '  In production, ships in batches  ',
          priceBreaks: [
            { minQty: 100, unitPrice: 18 },
            { minQty: 500, unitPrice: 15.5 },
          ],
        })
      );
    expect(res.status).toBe(201);
    expect(res.body.data.leadTimeDays).toBe(25);
    expect(res.body.data.stockQuantity).toBe(400);
    expect(res.body.data.availabilityNote).toBe('In production, ships in batches');
    expect(res.body.data.priceBreaks).toHaveLength(2);
    expect(res.body.data.priceBreaks[0].minQty).toBe(100);
    expect(res.body.data.priceBreaks[0].unitPrice).toBe(18);
    expect(res.body.data.priceBreaks[1].unitPrice).toBe(15.5);
    // moq predates this release and is untouched.
    expect(res.body.data.moq).toBe(50);

    const detail = await request(app).get(`/api/products/${res.body.data._id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.leadTimeDays).toBe(25);
    expect(detail.body.data.stockQuantity).toBe(400);
    expect(detail.body.data.priceBreaks).toHaveLength(2);

    const list = await request(app).get('/api/products');
    expect(list.status).toBe(200);
    const listed = list.body.data.find((p) => p._id === res.body.data._id);
    expect(listed).toBeTruthy();
    expect(listed.leadTimeDays).toBe(25);
    expect(listed.stockQuantity).toBe(400);
    expect(listed.availabilityNote).toBe('In production, ships in batches');
    expect(listed.priceBreaks).toHaveLength(2);
  });

  it('defaults are null / empty when the fields are not supplied', async () => {
    const created = await createProductViaApi();
    expect(created.leadTimeDays).toBeNull();
    expect(created.stockQuantity).toBeNull();
    expect(created.availabilityNote).toBe('');
    expect(created.priceBreaks).toEqual([]);
  });

  it('update changes the new fields and a later GET shows them', async () => {
    const created = await createProductViaApi({ leadTimeDays: 5, stockQuantity: 10 });

    const res = await request(app)
      .put(`/api/products/${created._id}`)
      .set(auth(adminToken))
      .send({
        leadTimeDays: 40,
        stockQuantity: 0,
        availabilityNote: 'Back-order only',
        priceBreaks: [{ minQty: 250, unitPrice: 12 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.leadTimeDays).toBe(40);
    expect(res.body.data.stockQuantity).toBe(0);
    expect(res.body.data.availabilityNote).toBe('Back-order only');
    expect(res.body.data.priceBreaks).toHaveLength(1);
    expect(res.body.data.priceBreaks[0].minQty).toBe(250);

    const detail = await request(app).get(`/api/products/${created._id}`);
    expect(detail.body.data.leadTimeDays).toBe(40);
    expect(detail.body.data.stockQuantity).toBe(0);
  });

  it('update can clear leadTimeDays/stockQuantity back to null', async () => {
    const created = await createProductViaApi({ leadTimeDays: 9, stockQuantity: 3 });
    const res = await request(app)
      .put(`/api/products/${created._id}`)
      .set(auth(adminToken))
      .send({ leadTimeDays: null, stockQuantity: null });
    expect(res.status).toBe(200);
    expect(res.body.data.leadTimeDays).toBeNull();
    expect(res.body.data.stockQuantity).toBeNull();
  });
});

// ── Validation ─────────────────────────────────────────────────────────────
describe('FEAT-09 — product inventory validation', () => {
  it('create rejects a negative leadTimeDays with 400', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send(productPayload({ leadTimeDays: -1 }));
    expect(res.status).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });

  it('create rejects a negative stockQuantity with 400', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send(productPayload({ stockQuantity: -5 }));
    expect(res.status).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });

  it('create rejects a price break with minQty 0 with 400', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send(productPayload({ priceBreaks: [{ minQty: 0, unitPrice: 10 }] }));
    expect(res.status).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });

  it('create rejects a price break with a negative unitPrice and a non-array priceBreaks', async () => {
    const badPrice = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send(productPayload({ priceBreaks: [{ minQty: 10, unitPrice: -1 }] }));
    expect(badPrice.status).toBe(400);

    const notArray = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send(productPayload({ priceBreaks: { minQty: 10, unitPrice: 5 } }));
    expect(notArray.status).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });

  it('update rejects invalid values with 400 and leaves the product unchanged', async () => {
    const created = await createProductViaApi({ leadTimeDays: 7, stockQuantity: 22 });

    const negLead = await request(app)
      .put(`/api/products/${created._id}`)
      .set(auth(adminToken))
      .send({ leadTimeDays: -2 });
    expect(negLead.status).toBe(400);

    const badBreak = await request(app)
      .put(`/api/products/${created._id}`)
      .set(auth(adminToken))
      .send({ priceBreaks: [{ minQty: 0, unitPrice: 9 }] });
    expect(badBreak.status).toBe(400);

    const saved = await Product.findById(created._id);
    expect(saved.leadTimeDays).toBe(7);
    expect(saved.stockQuantity).toBe(22);
    expect(saved.priceBreaks).toEqual([]);
  });

  it('a non-staff buyer cannot create products (existing guard holds)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(buyerToken))
      .send(productPayload({ leadTimeDays: 3 }));
    expect(res.status).toBe(403);
    expect(await Product.countDocuments()).toBe(0);
  });
});

// ── Estimated ship date ────────────────────────────────────────────────────
describe('FEAT-09 — estimatedShipDate on order detail', () => {
  const CREATED_AT = new Date('2026-01-05T10:00:00.000Z');

  const seedLeadProducts = async () => {
    const fast = await createProductViaApi({ leadTimeDays: 10 });
    const slow = await createProductViaApi({ leadTimeDays: 25 });
    const noLead = await createProductViaApi();
    return { fast, slow, noLead };
  };

  const itemFor = (p, qty = 10) => ({
    product: p._id,
    productName: p.name,
    sku: p.sku,
    quantity: qty,
    unitPrice: p.basePrice,
    totalPrice: p.basePrice * qty,
  });

  it('uses the MAX leadTimeDays across items: createdAt + 25 days', async () => {
    const { fast, slow } = await seedLeadProducts();
    const order = await makeOrderDoc(buyer, [itemFor(fast), itemFor(slow)], {
      createdAt: CREATED_AT,
    });

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body.data.createdAt).toBe(CREATED_AT.toISOString());
    expect(res.body.data.estimatedShipDate).toBe(
      new Date(CREATED_AT.getTime() + 25 * DAY_MS).toISOString()
    );

    // Serialization-time only: nothing is stored on the document.
    const saved = await Order.findById(order._id).lean();
    expect(saved.estimatedShipDate).toBeUndefined();
  });

  it('adds ORDER_LEAD_BUFFER_DAYS (read per call) on top of the max lead time', async () => {
    const { fast, slow } = await seedLeadProducts();
    const order = await makeOrderDoc(buyer, [itemFor(fast), itemFor(slow)], {
      createdAt: CREATED_AT,
    });

    process.env.ORDER_LEAD_BUFFER_DAYS = '3';
    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body.data.estimatedShipDate).toBe(
      new Date(CREATED_AT.getTime() + 28 * DAY_MS).toISOString()
    );

    // Dropping the env var drops the buffer on the very next call.
    delete process.env.ORDER_LEAD_BUFFER_DAYS;
    const res2 = await request(app)
      .get(`/api/orders/${order._id}`)
      .set(auth(buyerToken));
    expect(res2.body.data.estimatedShipDate).toBe(
      new Date(CREATED_AT.getTime() + 25 * DAY_MS).toISOString()
    );
  });

  it('items without lead times give estimatedShipDate = createdAt (+ buffer)', async () => {
    const { noLead } = await seedLeadProducts();
    // Item referencing a product with null leadTimeDays, plus an item
    // whose product no longer exists — both contribute 0.
    const ghost = {
      product: new mongoose.Types.ObjectId(),
      productName: 'Ghost',
      sku: 'GHOST-1',
      quantity: 5,
      unitPrice: 1,
      totalPrice: 5,
    };
    const order = await makeOrderDoc(buyer, [itemFor(noLead), ghost], {
      createdAt: CREATED_AT,
    });

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body.data.estimatedShipDate).toBe(CREATED_AT.toISOString());

    process.env.ORDER_LEAD_BUFFER_DAYS = '4';
    const buffered = await request(app)
      .get(`/api/orders/${order._id}`)
      .set(auth(buyerToken));
    expect(buffered.body.data.estimatedShipDate).toBe(
      new Date(CREATED_AT.getTime() + 4 * DAY_MS).toISOString()
    );
  });

  it('an order with no items gets estimatedShipDate null (helper + detail)', async () => {
    const order = await makeOrderDoc(buyer, [], { createdAt: CREATED_AT });
    expect(await computeEstimatedShipDate(order)).toBeNull();

    const res = await request(app)
      .get(`/api/orders/${order._id}`)
      .set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body.data.estimatedShipDate).toBeNull();
  });
});

// ── Regression: totals untouched, priceBreaks not wired into pricing ──────
describe('FEAT-09 — REGRESSION: order totals unchanged by inventory data', () => {
  it('API order totals match the existing tier pricing rules, with and without priceBreaks', async () => {
    // Gold tier = 12% distributor discount (existing pricing rules).
    const discount = getTierDiscountPercent('Gold');
    expect(discount).toBe(0.12);

    const product = await createProductViaApi({ basePrice: 20, leadTimeDays: 15 });

    const placeOrder = async () => {
      const res = await request(app)
        .post('/api/orders')
        .set(auth(goldToken))
        .send({
          items: [
            {
              product: product._id,
              productName: product.name,
              sku: product.sku,
              quantity: 100,
            },
          ],
        });
      expect(res.status).toBe(201);
      return res.body.order;
    };

    // Expected values from the pre-existing rules in createOrder:
    // subtotal = basePrice * qty; unit = basePrice * (1 - tier), 2dp;
    // total = unit * qty; discountAmount = subtotal - total.
    const expectedUnit = parseFloat((20 * (1 - discount)).toFixed(2)); // 17.6
    const expected = {
      totalQuantity: 100,
      subtotalAmount: 2000,
      discountAmount: parseFloat((2000 - expectedUnit * 100).toFixed(2)), // 240
      totalAmount: parseFloat((expectedUnit * 100).toFixed(2)), // 1760
    };

    const before = await placeOrder();
    expect(before.totalQuantity).toBe(expected.totalQuantity);
    expect(before.subtotalAmount).toBe(expected.subtotalAmount);
    expect(before.discountAmount).toBe(expected.discountAmount);
    expect(before.totalAmount).toBe(expected.totalAmount);

    // Adding aggressive priceBreaks must NOT change a new order's totals:
    // priceBreaks are data only in this release.
    const upd = await request(app)
      .put(`/api/products/${product._id}`)
      .set(auth(adminToken))
      .send({ priceBreaks: [{ minQty: 100, unitPrice: 1 }] });
    expect(upd.status).toBe(200);
    expect(upd.body.data.priceBreaks[0].unitPrice).toBe(1);

    const after = await placeOrder();
    expect(after.totalQuantity).toBe(expected.totalQuantity);
    expect(after.subtotalAmount).toBe(expected.subtotalAmount);
    expect(after.discountAmount).toBe(expected.discountAmount);
    expect(after.totalAmount).toBe(expected.totalAmount);
  });
});
