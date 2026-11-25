/**
 * platformV03.test.js
 * v0.3 platform workstream (B2):
 * - QOL-05: GET /api/docs serves a valid OpenAPI 3 spec in
 *   non-production (and 404s in production); the committed openapi.json
 *   matches the generated spec and the generation script runs.
 * - QOL-06: pino-backed logger keeps the {info,warn,error,debug}
 *   interface and emits JSON lines with level/message/requestId;
 *   GET /api/ready reports ready against a live DB; the Sentry guard
 *   no-ops without SENTRY_DSN.
 * - QOL-12: shared paginate helper + standard envelope
 *   {success,count,total,page,limit,data} on the endpoints that did
 *   not already emit it (products, my-orders, attribute sub-lists).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Writable } from 'stream';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import productRoutes from '../src/routes/productRoutes.js';
import attributeRoutes from '../src/routes/attributeRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { Finish, Category } from '../src/models/Attributes.js';
import { generateAccessToken } from '../src/utils/token.js';
import { buildOpenApiSpec } from '../src/utils/openapi.js';
import { readyHandler, docsHandler } from '../src/utils/metaHandlers.js';
import { createLogger } from '../src/utils/logger.js';
import { initSentry, isSentryInitialised, captureException } from '../src/utils/sentry.js';
import { parsePagination, paginatedResponse } from '../src/utils/paginate.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.get('/api/ready', readyHandler);
  app.get('/api/docs', docsHandler);
  app.use('/api/orders', orderRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/attributes', attributeRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'V03 Buyer',
  businessName: 'V03 Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `v03_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `v03_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'testpassword123',
  role: 'user',
  ...overrides,
});

let orderSeq = 0;
const makeOrder = (owner, status = 'Submitted') => ({
  orderNumber: `HAO-V03-${++orderSeq}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
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
});

let mongod;
let app;
let buyer;
let buyerToken;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
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
  await Product.deleteMany({});
  await Finish.deleteMany({});
  await Category.deleteMany({});
});

const ENVELOPE_KEYS = ['success', 'count', 'total', 'page', 'limit', 'data'];
const expectEnvelope = (body) => {
  for (const key of ENVELOPE_KEYS) expect(body).toHaveProperty(key);
  expect(body.success).toBe(true);
  expect(body.count).toBe(body.data.length);
};

// ── QOL-05: OpenAPI ────────────────────────────────────────────────────────
describe('QOL-05 — OpenAPI spec', () => {
  it('buildOpenApiSpec returns a valid OpenAPI 3 shape covering the required routes', () => {
    const spec = buildOpenApiSpec();
    expect(spec.openapi).toMatch(/^3\./);
    const paths = Object.keys(spec.paths);
    for (const p of [
      '/auth/signup',
      '/auth/login',
      '/auth/refresh',
      '/auth/logout',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/orders',
      '/orders/my-orders',
      '/orders/{id}',
      '/orders/{id}/status',
      '/products',
      '/products/{id}',
      '/users',
      '/users/{id}/toggle-status',
    ]) {
      expect(paths).toContain(p);
    }
    // Request bodies are derived from the Zod schemas.
    expect(spec.components.schemas.Login.required).toEqual(
      expect.arrayContaining(['usernameOrEmail', 'password'])
    );
    expect(spec.components.schemas.CreateOrder.properties).toHaveProperty('items');
    expect(spec.components.schemas.Signup.properties).toHaveProperty('email');
    expect(spec.components.schemas.UpdateOrderStatus.properties).toHaveProperty('status');
  });

  it('GET /api/docs returns 200 + the spec in non-production', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths).toHaveProperty('/orders');
    expect(res.body.paths).toHaveProperty('/products/{id}');
  });

  it('GET /api/docs 404s in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).get('/api/docs');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it('the generation script runs and the committed openapi.json matches the generated spec', () => {
    execFileSync(process.execPath, ['scripts/generate-openapi.js'], { cwd: repoRoot, stdio: 'pipe' });
    const committed = JSON.parse(readFileSync(path.join(repoRoot, 'openapi.json'), 'utf8'));
    expect(committed).toEqual(buildOpenApiSpec());
  });
});

// ── QOL-06: observability ──────────────────────────────────────────────────
describe('QOL-06 — logger, readiness, Sentry guard', () => {
  it('logger emits JSON lines with level/message and merges meta incl. requestId', async () => {
    const lines = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger(sink);
    log.info('hello v03', { requestId: 'req-123', extra: 1 });
    log.error('bad v03', { requestId: 'req-124' });
    // pino flushes asynchronously to the destination.
    await new Promise((r) => setTimeout(r, 100));
    const parsed = lines.join('').trim().split('\n').map((l) => JSON.parse(l));
    const info = parsed.find((l) => l.message === 'hello v03');
    expect(info).toBeTruthy();
    expect(info.level).toBe('INFO');
    expect(info.requestId).toBe('req-123');
    expect(info.extra).toBe(1);
    const err = parsed.find((l) => l.message === 'bad v03');
    expect(err.level).toBe('ERROR');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('GET /api/ready returns 200 ready when the DB is connected', async () => {
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: 'ready', db: 'connected' });
  });

  it('initSentry no-ops without SENTRY_DSN and captureException is safe', async () => {
    await expect(initSentry({})).resolves.toBe(false);
    expect(isSentryInitialised()).toBe(false);
    expect(() => captureException(new Error('ignored'))).not.toThrow();
  });
});

// ── QOL-12: pagination helper ──────────────────────────────────────────────
describe('QOL-12 — parsePagination / paginatedResponse', () => {
  it('applies the standard defaults and caps (page>=1, limit default 100, cap 100)', () => {
    expect(parsePagination({ query: {} })).toEqual({ page: 1, limit: 100, skip: 0 });
    expect(parsePagination({ query: { page: '0', limit: '1000' } })).toEqual({ page: 1, limit: 100, skip: 0 });
    expect(parsePagination({ query: { page: '3', limit: '10' } })).toEqual({ page: 3, limit: 10, skip: 20 });
    expect(parsePagination({ query: { page: 'x', limit: 'y' } })).toEqual({ page: 1, limit: 100, skip: 0 });
  });

  it('paginatedResponse emits exactly the standard envelope', () => {
    let statusCode;
    let payload;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
    };
    paginatedResponse(res, { items: [1, 2], total: 5, page: 2, limit: 2 });
    expect(statusCode).toBe(200);
    expect(Object.keys(payload)).toEqual(['success', 'count', 'total', 'page', 'limit', 'data']);
    expect(payload).toEqual({ success: true, count: 2, total: 5, page: 2, limit: 2, data: [1, 2] });
  });
});

describe('QOL-12 — products list envelope', () => {
  beforeEach(async () => {
    await Product.create([
      { name: 'Widget A', sku: 'V03-A', category: 'Tools' },
      { name: 'Widget B', sku: 'V03-B', category: 'Tools' },
      { name: 'Widget C', sku: 'V03-C', category: 'Tools' },
    ]);
  });

  it('emits the full envelope', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expectEnvelope(res.body);
    expect(res.body.total).toBe(3);
    expect(res.body.limit).toBe(100);
  });

  it('slices by page/limit', async () => {
    const page1 = await request(app).get('/api/products').query({ page: 1, limit: 2 });
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.count).toBe(2);
    const page2 = await request(app).get('/api/products').query({ page: 2, limit: 2 });
    expect(page2.body.data).toHaveLength(1);
    const skus = [...page1.body.data, ...page2.body.data].map((p) => p.sku).sort();
    expect(skus).toEqual(['V03-A', 'V03-B', 'V03-C']);
  });
});

describe('QOL-12 — my-orders envelope', () => {
  beforeEach(async () => {
    await Order.create([makeOrder(buyer), makeOrder(buyer), makeOrder(buyer)]);
  });

  it('emits the full envelope with the buyer total', async () => {
    const res = await request(app).get('/api/orders/my-orders').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expectEnvelope(res.body);
    expect(res.body.total).toBe(3);
  });

  it('slices by page/limit', async () => {
    const page2 = await request(app)
      .get('/api/orders/my-orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .query({ page: 2, limit: 2 });
    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.page).toBe(2);
    expect(page2.body.limit).toBe(2);
  });
});

describe('QOL-12 — attribute sub-list envelopes', () => {
  beforeEach(async () => {
    await Finish.create([{ name: 'Matte' }, { name: 'Gloss' }, { name: 'Satin' }]);
    await Category.create([
      { name: 'Hand Tools', slug: 'hand-tools' },
      { name: 'Fasteners', slug: 'fasteners' },
    ]);
  });

  it('GET /api/attributes/finishes emits the full envelope and slices', async () => {
    const res = await request(app).get('/api/attributes/finishes').query({ page: 1, limit: 2 });
    expect(res.status).toBe(200);
    expectEnvelope(res.body);
    expect(res.body.total).toBe(3);
    expect(res.body.data).toHaveLength(2);
    const page2 = await request(app).get('/api/attributes/finishes').query({ page: 2, limit: 2 });
    expect(page2.body.data).toHaveLength(1);
  });

  it('GET /api/attributes/categories emits the full envelope', async () => {
    const res = await request(app).get('/api/attributes/categories');
    expect(res.status).toBe(200);
    expectEnvelope(res.body);
    expect(res.body.total).toBe(2);
  });

  it('GET /api/attributes/colors, /brands, /sizes emit the envelope when empty', async () => {
    for (const sub of ['colors', 'brands', 'sizes']) {
      const res = await request(app).get(`/api/attributes/${sub}`);
      expect(res.status).toBe(200);
      expectEnvelope(res.body);
      expect(res.body.total).toBe(0);
    }
  });
});
