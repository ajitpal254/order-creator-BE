/**
 * fxV05.test.js
 * FEAT-04 (v0.5) — multi-currency FX:
 * - (a) ECB XML parser correctness on a sample payload.
 * - (b) GET /api/fx/rates returns cached data when the ECB fetch
 *   fails but a cache exists (and never 500s with no cache either).
 * - (c) Confirming an order (real PATCH /api/orders/:id/status flow,
 *   staff user) locks fxRateLocked / baseCurrency / baseTotal and
 *   leaves totalAmount unchanged.
 * - (d) An FX fetch failure during confirmation does not break the
 *   confirmation — the order still ends up Confirmed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import fxRoutes from '../src/routes/fxRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Invoice } from '../src/models/Invoice.js';
import { FxRate } from '../src/models/FxRate.js';
import { generateAccessToken } from '../src/utils/token.js';
import {
  parseEcbXml,
  fetchEcbRates,
  convert,
  FALLBACK_RATES,
} from '../src/services/fx.js';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/orders', orderRoutes);
  app.use('/api/fx', fxRoutes);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });
  return app;
}

const SAMPLE_ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
  <Cube>
    <Cube time="2025-11-25">
      <Cube currency='USD' rate='1.1570'/>
      <Cube currency='GBP' rate='0.8765'/>
      <Cube currency='AUD' rate='1.7823'/>
      <Cube currency='JPY' rate='181.23'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const originalFetch = global.fetch;

const mockFetchFails = () => {
  global.fetch = vi.fn(async () => {
    throw new Error('network unreachable');
  });
};
const mockFetchReturnsXml = (xml = SAMPLE_ECB_XML) => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => xml,
  }));
};

const makeUser = (overrides = {}) => ({
  customerName: 'FX Buyer',
  businessName: 'FX Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `fx_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `fx_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'Password123!',
  role: 'user',
  ...overrides,
});

let orderSeq = 0;
const makeOrder = (owner, status, overrides = {}) => ({
  orderNumber: `HAO-FX-${++orderSeq}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
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
  currency: 'EUR',
  incoterm: 'FOB',
  status,
  ...overrides,
});

let mongod;
let app;
let buyer, admin;
let buyerToken, adminToken;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
  buyer = await User.create(makeUser({ customerName: 'FX Owner' }));
  admin = await User.create(makeUser({ customerName: 'FX Admin', role: 'admin' }));
  buyerToken = generateAccessToken(buyer);
  adminToken = generateAccessToken(admin);
}, 60000);

afterAll(async () => {
  global.fetch = originalFetch;
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await Order.deleteMany({});
  await Invoice.deleteMany({});
  await FxRate.deleteMany({});
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ── (a) Parser + convert ─────────────────────────────────────────────────────
describe('FEAT-04 — ECB XML parser', () => {
  it('parses the sample ECB XML into the expected rates object', () => {
    const rates = parseEcbXml(SAMPLE_ECB_XML);
    expect(rates).toEqual({
      EUR: 1,
      USD: 1.157,
      GBP: 0.8765,
      AUD: 1.7823,
      JPY: 181.23,
    });
  });

  it('fetchEcbRates returns the parsed rates from a (mocked) ECB response', async () => {
    mockFetchReturnsXml();
    const rates = await fetchEcbRates();
    expect(rates.USD).toBe(1.157);
    expect(rates.GBP).toBe(0.8765);
    expect(rates.EUR).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('convert uses EUR-based cross rates', () => {
    const rates = { EUR: 1, USD: 1.2, GBP: 0.8, AUD: 1.6 };
    expect(convert(100, 'EUR', 'USD', rates)).toBeCloseTo(120);
    expect(convert(120, 'USD', 'EUR', rates)).toBeCloseTo(100);
    expect(convert(80, 'GBP', 'USD', rates)).toBeCloseTo(120);
    expect(convert(50, 'USD', 'USD', rates)).toBeCloseTo(50);
    expect(convert(1, 'EUR', 'USD', rates)).toBeCloseTo(1.2);
  });
});

// ── (b) GET /api/fx/rates cache behaviour ────────────────────────────────────
describe('FEAT-04 — GET /api/fx/rates', () => {
  it('requires authentication (401 without a token)', async () => {
    const res = await request(app).get('/api/fx/rates');
    expect(res.status).toBe(401);
  });

  it('returns cached data when the fetch fails but a (stale) cache exists', async () => {
    await FxRate.create({
      base: 'EUR',
      rates: { EUR: 1, USD: 9.99, GBP: 8.88, AUD: 7.77 },
      fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // stale: forces a refresh attempt
    });
    mockFetchFails();

    const res = await request(app)
      .get('/api/fx/rates')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.base).toBe('EUR');
    expect(res.body.data.rates.USD).toBe(9.99);
    expect(res.body.data.rates.GBP).toBe(8.88);
    expect(res.body.data.asOf).toBeTruthy();
  });

  it('returns fresh cached data without needing the network', async () => {
    await FxRate.create({
      base: 'EUR',
      rates: { EUR: 1, USD: 1.25, GBP: 0.9, AUD: 1.7 },
      fetchedAt: new Date(),
    });
    mockFetchFails();

    const res = await request(app)
      .get('/api/fx/rates')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.rates.USD).toBe(1.25);
  });

  it('never 500s: with no cache and a failing fetch it serves the fallback snapshot', async () => {
    mockFetchFails();

    const res = await request(app)
      .get('/api/fx/rates')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.base).toBe('EUR');
    expect(res.body.data.rates).toEqual(FALLBACK_RATES);
  });

  it('refreshes and persists rates when the ECB fetch succeeds', async () => {
    mockFetchReturnsXml();

    const res = await request(app)
      .get('/api/fx/rates')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.rates.USD).toBe(1.157);
    const persisted = await FxRate.findOne({});
    expect(persisted).not.toBeNull();
    expect(persisted.rates.USD).toBe(1.157);
  });
});

// ── (c) Rate lock on confirmation ────────────────────────────────────────────
describe('FEAT-04 — FX lock on order confirmation', () => {
  it('confirming an EUR order sets fxRateLocked/baseCurrency/baseTotal and leaves totalAmount unchanged', async () => {
    // Fresh cache: EUR-based rates, 1 EUR = 1.20 USD.
    await FxRate.create({
      base: 'EUR',
      rates: { EUR: 1, USD: 1.2, GBP: 0.85, AUD: 1.6 },
      fetchedAt: new Date(),
    });
    mockFetchFails(); // must not be needed — fresh cache wins

    const order = await Order.create(
      makeOrder(buyer, 'Submitted', { currency: 'EUR', totalAmount: 50, subtotalAmount: 50 })
    );

    const res = await request(app)
      .patch(`/api/orders/${order._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Confirmed' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Confirmed');

    const after = await Order.findById(order._id);
    expect(after.status).toBe('Confirmed');
    expect(after.fxRateLocked).toBeCloseTo(1.2);
    expect(after.baseCurrency).toBe('USD');
    expect(after.baseTotal).toBe(60); // 50 EUR * 1.2, 2dp
    expect(after.totalAmount).toBe(50); // unchanged
  });

  it('confirming a USD order locks rate 1 and baseTotal === totalAmount', async () => {
    await FxRate.create({
      base: 'EUR',
      rates: { EUR: 1, USD: 1.2, GBP: 0.85, AUD: 1.6 },
      fetchedAt: new Date(),
    });

    const order = await Order.create(
      makeOrder(buyer, 'Submitted', { currency: 'USD', totalAmount: 75, subtotalAmount: 75 })
    );

    const res = await request(app)
      .patch(`/api/orders/${order._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Confirmed' });

    expect(res.status).toBe(200);
    const after = await Order.findById(order._id);
    expect(after.fxRateLocked).toBe(1);
    expect(after.baseCurrency).toBe('USD');
    expect(after.baseTotal).toBe(75);
    expect(after.totalAmount).toBe(75);
  });
});

// ── (d) FX failure does not break confirmation ───────────────────────────────
describe('FEAT-04 — FX failure isolation', () => {
  it('an FX fetch failure during confirmation still confirms the order', async () => {
    // No cache at all + fetch blows up: getRates degrades to the
    // fallback snapshot, and even a hard FX error is wrapped so the
    // transition itself can never be broken by FX.
    mockFetchFails();

    const order = await Order.create(
      makeOrder(buyer, 'Submitted', { currency: 'GBP', totalAmount: 100, subtotalAmount: 100 })
    );

    const res = await request(app)
      .patch(`/api/orders/${order._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Confirmed' });

    expect(res.status).toBe(200);
    const after = await Order.findById(order._id);
    expect(after.status).toBe('Confirmed');
    expect(after.totalAmount).toBe(100);
  });
});
