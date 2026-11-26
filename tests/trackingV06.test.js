/**
 * trackingV06.test.js
 * FEAT-06 (v0.6) — public order tracking:
 * - src/utils/trackingToken.js: HMAC-signed (node:crypto) compact tokens,
 *   {oid, exp} payload, timing-safe verify, never throws.
 * - GET /api/orders/:id/tracking-link (protect; owner or staff; another
 *   buyer -> 404 per SEC-01) returns {token, url, expiresAt}.
 * - GET /api/track/:token is PUBLIC and returns ONLY the whitelisted
 *   fields {orderNumber, status, timeline, carrier, trackingNumber,
 *   trackingUrl} — no prices, buyer identity, addresses, items, user ids.
 * - Invalid / tampered / expired / unknown-order tokens -> 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';

process.env.JWT_SECRET = 'tracking-v06-test-secret-0123456789abcdef';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import trackingRoutes from '../src/routes/trackingRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { generateAccessToken } from '../src/utils/token.js';
import { createTrackingToken, verifyTrackingToken } from '../src/utils/trackingToken.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/orders', orderRoutes);
  app.use('/api/track', trackingRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Tracking Buyer',
  businessName: 'Tracking Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `track_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `track_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'Str0ng!Pass',
  role: 'user',
  ...overrides,
});

let mongod;
let app;
let buyer, buyerToken;
let other, otherToken;
let admin, adminToken;
let order;
let seq = 0;

const makeOrder = async (owner, overrides = {}) => {
  seq += 1;
  return Order.create({
    orderNumber: `HAO-2026-${400000 + seq}`,
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
    items: [
      { productName: 'Test Hammer', sku: 'TST-HMR-001', quantity: 10, unitPrice: 10, totalPrice: 100 },
    ],
    totalQuantity: 10,
    subtotalAmount: 100,
    totalAmount: 100,
    currency: 'USD',
    status: 'Shipped',
    carrierName: 'DHL',
    trackingNumber: 'DHL123456789',
    trackingUrl: 'https://www.dhl.com/track/DHL123456789',
    timeline: [
      { status: 'Submitted', updatedBy: 'buyer', updatedAt: new Date('2026-11-01T10:00:00Z') },
      { status: 'Shipped', updatedBy: 'shipping_officer', updatedAt: new Date('2026-11-05T10:00:00Z'), note: 'Left origin facility' },
    ],
    ...overrides,
  });
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// Recursively collect every key in a (JSON) object graph.
const collectKeys = (value, acc = new Set()) => {
  if (Array.isArray(value)) {
    value.forEach((v) => collectKeys(v, acc));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([k, v]) => {
      acc.add(k);
      collectKeys(v, acc);
    });
  }
  return acc;
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
  buyer = await User.create(makeUser());
  buyerToken = generateAccessToken(buyer);
  other = await User.create(makeUser());
  otherToken = generateAccessToken(other);
  admin = await User.create(makeUser({ role: 'admin' }));
  adminToken = generateAccessToken(admin);
  order = await makeOrder(buyer);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

describe('trackingToken util', () => {
  it('round-trips a valid token', () => {
    const { token } = createTrackingToken(order._id);
    expect(verifyTrackingToken(token)).toEqual({ orderId: order._id.toString() });
  });

  it('returns null (never throws) for malformed input', () => {
    expect(verifyTrackingToken('')).toBeNull();
    expect(verifyTrackingToken('garbage')).toBeNull();
    expect(verifyTrackingToken('a.b.c')).toBeNull();
    expect(verifyTrackingToken(null)).toBeNull();
    expect(verifyTrackingToken(undefined)).toBeNull();
    expect(verifyTrackingToken(42)).toBeNull();
  });
});

describe('GET /api/orders/:id/tracking-link', () => {
  it('owner gets a token, url and ~30-day expiry', async () => {
    const res = await request(app)
      .get(`/api/orders/${order._id}/tracking-link`)
      .set(auth(buyerToken));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { token, url, expiresAt } = res.body.data;
    expect(typeof token).toBe('string');
    expect(url.endsWith(`/track/${token}`)).toBe(true);
    const ttlMs = new Date(expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);
    // The issued token must verify against the order.
    expect(verifyTrackingToken(token)).toEqual({ orderId: order._id.toString() });
  });

  it('staff can get a tracking link for any order', async () => {
    const res = await request(app)
      .get(`/api/orders/${order._id}/tracking-link`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
  });

  it('another buyer gets 404 (SEC-01)', async () => {
    const res = await request(app)
      .get(`/api/orders/${order._id}/tracking-link`)
      .set(auth(otherToken));
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('unauthenticated request gets 401', async () => {
    const res = await request(app).get(`/api/orders/${order._id}/tracking-link`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/track/:token (public)', () => {
  it('returns exactly the whitelisted fields and nothing sensitive', async () => {
    const { token } = createTrackingToken(order._id);
    const res = await request(app).get(`/api/track/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(Object.keys(data).sort()).toEqual(
      ['carrier', 'orderNumber', 'status', 'timeline', 'trackingNumber', 'trackingUrl'].sort()
    );
    expect(data.orderNumber).toBe(order.orderNumber);
    expect(data.status).toBe('Shipped');
    expect(data.carrier).toBe('DHL');
    expect(data.trackingNumber).toBe('DHL123456789');
    expect(data.trackingUrl).toBe('https://www.dhl.com/track/DHL123456789');

    // Timeline mapped to {status, at, note?} — updatedBy must be dropped.
    expect(data.timeline).toHaveLength(2);
    expect(data.timeline[0]).toEqual({ status: 'Submitted', at: '2026-11-01T10:00:00.000Z' });
    expect(data.timeline[1]).toEqual({
      status: 'Shipped',
      at: '2026-11-05T10:00:00.000Z',
      note: 'Left origin facility',
    });

    // No sensitive key anywhere in the payload, at any depth.
    const keys = collectKeys(res.body);
    for (const forbidden of ['total', 'price', 'email', 'address']) {
      for (const key of keys) {
        expect(key.toLowerCase()).not.toContain(forbidden);
      }
    }
    expect(keys.has('updatedBy')).toBe(false);
    expect(keys.has('user')).toBe(false);
    expect(keys.has('items')).toBe(false);
    expect(keys.has('customerDetails')).toBe(false);
  });

  it('tampered signature -> 404', async () => {
    const { token } = createTrackingToken(order._id);
    const [payloadPart, sig] = token.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const res = await request(app).get(`/api/track/${payloadPart}.${flipped}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Tracking link not found or expired' });
  });

  it('expired token -> 404', async () => {
    const { token } = createTrackingToken(order._id, { ttlDays: -1 });
    expect(verifyTrackingToken(token)).toBeNull();
    const res = await request(app).get(`/api/track/${token}`);
    expect(res.status).toBe(404);
  });

  it('garbage token -> 404', async () => {
    const res = await request(app).get('/api/track/not-a-real-token');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('valid signature for an unknown order id -> 404', async () => {
    const { token } = createTrackingToken(new mongoose.Types.ObjectId());
    const res = await request(app).get(`/api/track/${token}`);
    expect(res.status).toBe(404);
  });
});
