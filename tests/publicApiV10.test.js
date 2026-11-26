/**
 * publicApiV10.test.js — FEAT-15 (v1.0) Public API + Webhooks
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import http from 'http';

// Plain recording functions (not vi.fn) — vitest clears mock history
// before each test, which would erase the import-time registration.
const queueMocks = vi.hoisted(() => {
  const state = { calls: [], registrations: [] };
  return {
    state,
    enqueueJob: async (name, payload, opts) => { state.calls.push({ name, payload, opts }); },
    registerJobHandler: (name) => { state.registrations.push(name); },
  };
});
vi.mock('../src/services/queue.js', () => queueMocks);

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import developerRoutes from '../src/routes/developerRoutes.js';
import publicApiRoutes from '../src/routes/publicApiRoutes.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { ApiKey, hashApiKey } from '../src/models/ApiKey.js';
import { WebhookSubscription } from '../src/models/WebhookSubscription.js';
import { WebhookDelivery } from '../src/models/WebhookDelivery.js';
import { emitWebhookEvent, processWebhookDelivery } from '../src/services/webhooks.js';
import { generateAccessToken } from '../src/utils/token.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/developer', developerRoutes);
  app.use('/api/public/v1', publicApiRoutes);
  app.use('/api/orders', orderRoutes);
  app.use(globalErrorHandler);
  return app;
}

let counter = 0;
const makeUser = (overrides = {}) => {
  counter += 1;
  return {
    customerName: 'Public Buyer',
    businessName: 'Public Corp',
    country: 'Canada',
    phoneNumber: '+1-555-0100',
    address: '123 Test St',
    username: `pub_${Date.now()}_${counter}`,
    email: `pub_${Date.now()}_${counter}@example.com`,
    password: 'longpassword1',
    role: 'user',
    ...overrides,
  };
};

let mongod, app, buyer, buyerToken, other, otherToken, admin, adminToken;

const createKeyViaApi = async (token, scopes, name = 'Test Key') => {
  const res = await request(app)
    .post('/api/developer/keys')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, scopes });
  expect(res.status).toBe(201);
  return res.body;
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
}, 60000);

afterAll(async () => {
  delete process.env.PUBLIC_API_RATE_MAX;
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await ApiKey.deleteMany({});
  await WebhookSubscription.deleteMany({});
  await WebhookDelivery.deleteMany({});
  await Order.deleteMany({});
  await Product.deleteMany({});
  queueMocks.state.calls.length = 0;
  delete process.env.PUBLIC_API_RATE_MAX;
});

describe('API key lifecycle', () => {
  it('create returns plaintext once; DB stores only the SHA-256 hash', async () => {
    const body = await createKeyViaApi(buyerToken, ['products:read']);
    expect(body.key).toMatch(/^hao_[0-9a-f]{64}$/);
    expect(body.prefix).toBe(body.key.slice(0, 8));
    const stored = await ApiKey.findById(body.id);
    expect(stored.keyHash).toBe(hashApiKey(body.key));
    expect(stored.keyHash).not.toBe(body.key);
    expect(JSON.stringify(stored.toObject())).not.toContain(body.key);
  });

  it('list shows metadata only — no key, no hash', async () => {
    const body = await createKeyViaApi(buyerToken, ['orders:read']);
    const res = await request(app).get('/api/developer/keys').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].prefix).toBe(body.prefix);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(body.key);
    expect(raw).not.toContain('keyHash');
  });

  it('invalid scope -> 400', async () => {
    const res = await request(app)
      .post('/api/developer/keys')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ name: 'x', scopes: ['admin:all'] });
    expect(res.status).toBe(400);
  });

  it("managing another user's key -> 404, and revoke makes public calls 401", async () => {
    const body = await createKeyViaApi(buyerToken, ['products:read']);
    const delOther = await request(app)
      .delete(`/api/developer/keys/${body.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(delOther.status).toBe(404);

    const ok = await request(app).get('/api/public/v1/products').set('X-API-Key', body.key);
    expect(ok.status).toBe(200);

    const del = await request(app)
      .delete(`/api/developer/keys/${body.id}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(del.status).toBe(200);
    expect((await ApiKey.findById(body.id)).revokedAt).toBeTruthy();

    const after = await request(app).get('/api/public/v1/products').set('X-API-Key', body.key);
    expect(after.status).toBe(401);
  });

  it('missing and invalid keys -> 401', async () => {
    const missing = await request(app).get('/api/public/v1/products');
    expect(missing.status).toBe(401);
    expect(missing.body.success).toBe(false);
    const bad = await request(app).get('/api/public/v1/products').set('X-API-Key', 'hao_deadbeef');
    expect(bad.status).toBe(401);
  });
});

describe('Public API endpoints', () => {
  it('products list via key returns the paginated envelope of active products', async () => {
    await Product.create({ name: 'Hammer', sku: 'HAM-PUB-1', category: 'Tools', basePrice: 25 });
    const { key } = await createKeyViaApi(buyerToken, ['products:read']);
    const res = await request(app).get('/api/public/v1/products').set('X-API-Key', key);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].sku).toBe('HAM-PUB-1');
    // lastUsedAt is stamped (fire-and-forget — allow a tick)
    await new Promise((r) => setTimeout(r, 50));
    expect((await ApiKey.findOne({ owner: buyer._id })).lastUsedAt).toBeTruthy();
  });

  it('scope enforcement: read-only key cannot POST orders -> 403', async () => {
    const { key } = await createKeyViaApi(buyerToken, ['products:read', 'orders:read']);
    const res = await request(app)
      .post('/api/public/v1/orders')
      .set('X-API-Key', key)
      .send({ items: [{ productName: 'Hammer', sku: 'HAM-1', quantity: 1, unitPrice: 10 }] });
    expect(res.status).toBe(403);
  });

  it('order create via key lands owned by the key owner with server-computed totals', async () => {
    const { key } = await createKeyViaApi(buyerToken, ['orders:write']);
    const res = await request(app)
      .post('/api/public/v1/orders')
      .set('X-API-Key', key)
      .send({ items: [{ productName: 'Hammer', sku: 'HAM-1', quantity: 2, unitPrice: 50 }] });
    expect(res.status).toBe(201);
    expect(res.body.order.user.toString()).toBe(buyer._id.toString());
    expect(res.body.order.totalAmount).toBe(100);
    const stored = await Order.findById(res.body.order._id);
    expect(stored.user.toString()).toBe(buyer._id.toString());
    expect(stored.totalAmount).toBe(100);
  });

  it('order read: owner can read, other owner gets 404', async () => {
    const created = await Order.create({
      orderNumber: 'HAO-2026-700001',
      user: buyer._id,
      customerDetails: { customerName: buyer.customerName, businessName: buyer.businessName, email: buyer.email },
      items: [{ productName: 'Hammer', sku: 'HAM-1', quantity: 1, unitPrice: 100 }],
      totalAmount: 100,
      currency: 'USD',
      status: 'Submitted',
    });
    const mine = await createKeyViaApi(buyerToken, ['orders:read']);
    const okRes = await request(app).get(`/api/public/v1/orders/${created._id}`).set('X-API-Key', mine.key);
    expect(okRes.status).toBe(200);
    expect(okRes.body.data._id).toBe(created._id.toString());

    const theirs = await createKeyViaApi(otherToken, ['orders:read']);
    const noRes = await request(app).get(`/api/public/v1/orders/${created._id}`).set('X-API-Key', theirs.key);
    expect(noRes.status).toBe(404);
  });

  it('per-key rate limit: PUBLIC_API_RATE_MAX is honoured', async () => {
    const { key } = await createKeyViaApi(buyerToken, ['products:read']);
    process.env.PUBLIC_API_RATE_MAX = '3';
    try {
      for (let i = 0; i < 3; i += 1) {
        const res = await request(app).get('/api/public/v1/products').set('X-API-Key', key);
        expect(res.status).toBe(200);
      }
      const limited = await request(app).get('/api/public/v1/products').set('X-API-Key', key);
      expect(limited.status).toBe(429);
    } finally {
      delete process.env.PUBLIC_API_RATE_MAX;
    }
  });
});

describe('Webhook subscriptions CRUD', () => {
  it('create validates https + events, returns the secret once; list hides it', async () => {
    const badUrl = await request(app)
      .post('/api/developer/webhooks')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ url: 'http://example.com/hook', events: ['order.created'] });
    expect(badUrl.status).toBe(400);

    const badEvent = await request(app)
      .post('/api/developer/webhooks')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ url: 'https://example.com/hook', events: ['order.deleted'] });
    expect(badEvent.status).toBe(400);

    const res = await request(app)
      .post('/api/developer/webhooks')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ url: 'https://example.com/hook', events: ['order.created'] });
    expect(res.status).toBe(201);
    expect(res.body.data.secret).toMatch(/^whsec_[0-9a-f]+$/);
    const secret = res.body.data.secret;

    const list = await request(app).get('/api/developer/webhooks').set('Authorization', `Bearer ${buyerToken}`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(secret);

    // Another user cannot patch/delete it
    const id = res.body.data.id;
    const patchOther = await request(app)
      .patch(`/api/developer/webhooks/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ active: false });
    expect(patchOther.status).toBe(404);

    const patch = await request(app)
      .patch(`/api/developer/webhooks/${id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ active: false, events: ['order.created', 'payment.confirmed'] });
    expect(patch.status).toBe(200);
    expect(patch.body.data.active).toBe(false);
    expect(patch.body.data.events).toContain('payment.confirmed');
    expect(JSON.stringify(patch.body)).not.toContain(secret);

    const del = await request(app)
      .delete(`/api/developer/webhooks/${id}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(del.status).toBe(200);
    expect(await WebhookSubscription.findById(id)).toBeNull();
  });

  it('queue handler is registered at import time', () => {
    expect(queueMocks.state.registrations).toContain('webhook.deliver');
  });
});

describe('Webhook delivery engine', () => {
  const startServer = (handler) =>
    new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => resolve(server));
    });

  it('delivers with a correct HMAC signature and payload shape', async () => {
    const received = [];
    const server = await startServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        received.push({ headers: req.headers, raw });
        res.writeHead(200).end('ok');
      });
    });
    try {
      const port = server.address().port;
      const secret = 'whsec_testsecret123';
      const sub = await WebhookSubscription.create({
        owner: buyer._id,
        url: `http://127.0.0.1:${port}/hook`,
        events: ['order.created'],
        secret,
      });
      await emitWebhookEvent(buyer._id, 'order.created', { orderId: 'abc', orderNumber: 'HAO-1' });
      // emit enqueues via the (mocked) queue — the delivery row exists
      expect(queueMocks.state.calls).toEqual([
        expect.objectContaining({ name: 'webhook.deliver', payload: expect.objectContaining({ deliveryId: expect.any(String) }) }),
      ]);
      const delivery = await WebhookDelivery.findOne({ subscription: sub._id });
      expect(delivery).toBeTruthy();
      expect(delivery.payload.event).toBe('order.created');
      expect(delivery.payload.id).toBe(delivery._id.toString());
      expect(delivery.payload.data.orderNumber).toBe('HAO-1');

      const result = await processWebhookDelivery(delivery._id);
      expect(result.status).toBe('delivered');
      expect(result.attempts).toBe(1);
      expect(result.lastStatusCode).toBe(200);
      expect(received).toHaveLength(1);
      const expectedSig = 'sha256=' + crypto.createHmac('sha256', secret).update(received[0].raw).digest('hex');
      expect(received[0].headers['x-hao-signature']).toBe(expectedSig);
      expect(received[0].headers['x-hao-event']).toBe('order.created');
      expect(received[0].headers['x-hao-delivery']).toBe(delivery._id.toString());
      expect(JSON.parse(received[0].raw).data.orderNumber).toBe('HAO-1');
    } finally {
      server.close();
    }
  });

  it('retries on failure (stays pending, re-enqueues) then delivers', async () => {
    let calls = 0;
    const server = await startServer((req, res) => {
      req.resume();
      req.on('end', () => {
        calls += 1;
        res.writeHead(calls === 1 ? 500 : 200).end('x');
      });
    });
    try {
      const port = server.address().port;
      const sub = await WebhookSubscription.create({
        owner: buyer._id,
        url: `http://127.0.0.1:${port}/hook`,
        events: ['order.created'],
        secret: 'whsec_retrysecret',
      });
      const delivery = await WebhookDelivery.create({
        subscription: sub._id,
        owner: buyer._id,
        event: 'order.created',
        payload: { id: 'x', event: 'order.created', createdAt: new Date().toISOString(), data: {} },
      });
      queueMocks.state.calls.length = 0;
      const first = await processWebhookDelivery(delivery._id);
      expect(first.status).toBe('pending');
      expect(first.attempts).toBe(1);
      expect(first.lastStatusCode).toBe(500);
      expect(first.lastError).toContain('500');
      expect(queueMocks.state.calls).toEqual([
        expect.objectContaining({
          name: 'webhook.deliver',
          payload: { deliveryId: delivery._id.toString() },
          opts: expect.objectContaining({ delayMs: expect.any(Number) }),
        }),
      ]);

      const second = await processWebhookDelivery(delivery._id);
      expect(second.status).toBe('delivered');
      expect(second.attempts).toBe(2);

      // Delivery log endpoint reflects the delivery
      const log = await request(app)
        .get(`/api/developer/webhooks/${sub._id}/deliveries`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(log.status).toBe(200);
      expect(log.body.data).toHaveLength(1);
      expect(log.body.data[0].status).toBe('delivered');
    } finally {
      server.close();
    }
  });

  it('marks failed after max attempts', async () => {
    const server = await startServer((req, res) => { req.resume(); req.on('end', () => res.writeHead(500).end('x')); });
    try {
      const port = server.address().port;
      const sub = await WebhookSubscription.create({
        owner: buyer._id,
        url: `http://127.0.0.1:${port}/hook`,
        events: ['order.created'],
        secret: 'whsec_failsecret',
      });
      const delivery = await WebhookDelivery.create({
        subscription: sub._id,
        owner: buyer._id,
        event: 'order.created',
        payload: { event: 'order.created', data: {} },
        attempts: 4,
      });
      const result = await processWebhookDelivery(delivery._id);
      expect(result.attempts).toBe(5);
      expect(result.status).toBe('failed');
    } finally {
      server.close();
    }
  });
});

describe('Event emission from order flows', () => {
  it('order status change creates status_changed + confirmed deliveries for the owner', async () => {
    await WebhookSubscription.create({
      owner: buyer._id,
      url: 'https://example.com/hook',
      events: ['order.status_changed', 'order.confirmed'],
      secret: 'whsec_emission',
    });
    const order = await Order.create({
      orderNumber: 'HAO-2026-700002',
      user: buyer._id,
      customerDetails: { customerName: buyer.customerName, businessName: buyer.businessName, email: buyer.email },
      items: [{ productName: 'Hammer', sku: 'HAM-1', quantity: 1, unitPrice: 100 }],
      totalAmount: 100,
      currency: 'USD',
      status: 'Submitted',
    });
    const res = await request(app)
      .patch(`/api/orders/${order._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Confirmed' });
    expect(res.status).toBe(200);
    const deliveries = await WebhookDelivery.find({ owner: buyer._id }).sort({ event: 1 });
    const events = deliveries.map((d) => d.event).sort();
    expect(events).toEqual(['order.confirmed', 'order.status_changed']);
    const changed = deliveries.find((d) => d.event === 'order.status_changed');
    expect(changed.payload.data.from).toBe('Submitted');
    expect(changed.payload.data.to).toBe('Confirmed');
    expect(changed.payload.data.orderNumber).toBe('HAO-2026-700002');
    // No buyer email in webhook payloads
    expect(JSON.stringify(changed.payload)).not.toContain(buyer.email);
  });

  it('order creation via the internal route emits order.created', async () => {
    await WebhookSubscription.create({
      owner: buyer._id,
      url: 'https://example.com/hook',
      events: ['order.created'],
      secret: 'whsec_created',
    });
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ items: [{ productName: 'Hammer', sku: 'HAM-1', quantity: 1, unitPrice: 10 }] });
    expect(res.status).toBe(201);
    const delivery = await WebhookDelivery.findOne({ owner: buyer._id, event: 'order.created' });
    expect(delivery).toBeTruthy();
    expect(delivery.payload.data.orderNumber).toBe(res.body.order.orderNumber);
  });
});
