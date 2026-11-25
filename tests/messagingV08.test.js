/**
 * messagingV08.test.js
 * FEAT-11 (v0.8) — WhatsApp notifications (env-gated):
 * - Opt-in gate: no MessageLog row when the buyer has not opted in
 *   (notifications.whatsapp !== true) or has no phone on file.
 * - Without WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID, intended sends
 *   are recorded as 'simulated' — never 'sent'.
 * - With both env vars set, the meta adapter POSTs a template message
 *   to the WhatsApp Cloud API (mocked global fetch): correct URL,
 *   Authorization header and template payload; a 200 records 'sent'.
 * - Provider failure (non-200 or a thrown fetch) records 'failed' and
 *   does NOT break the underlying order event / notification flow.
 * - Wiring: order Confirmed + Shipped transitions and quote-accepted
 *   fan out from the v0.4 notify/outbox services.
 * - Profile update: phone (E.164-ish) is validated — bad numbers get
 *   400, good ones are stored; notifications.whatsapp is accepted.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import authRoutes from '../src/routes/authRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Notification } from '../src/models/Notification.js';
import { MessageLog } from '../src/models/MessageLog.js';
import { generateAccessToken } from '../src/utils/token.js';
import {
  sendWhatsAppTemplate,
  sendOrderConfirmedWhatsApp,
  isValidPhone,
} from '../src/services/messaging.js';
import { notifyOrderStatusChanged } from '../src/services/notify.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/orders', orderRoutes);
  app.use('/api/auth', authRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'WhatsApp Buyer',
  businessName: 'WhatsApp Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `wa_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `wa_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'testpassword123',
  role: 'user',
  ...overrides,
});

const BUYER_PHONE = '+14155550123';

let mongod;
let app;
let buyer, buyerToken;
let admin, adminToken;

const optInBuyer = async (phone = BUYER_PHONE) => {
  await User.updateOne(
    { _id: buyer._id },
    { $set: { phone, 'notifications.whatsapp': true } }
  );
  buyer = await User.findById(buyer._id);
  return buyer;
};

beforeAll(async () => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
  buyer = await User.create(makeUser());
  buyerToken = generateAccessToken(buyer);
  admin = await User.create(makeUser({ role: 'admin' }));
  adminToken = generateAccessToken(admin);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  await MessageLog.deleteMany({});
  await Notification.deleteMany({});
  await Order.deleteMany({});
  await User.updateOne(
    { _id: buyer._id },
    { $set: { phone: '', 'notifications.whatsapp': false, 'notifications.email': true } }
  );
  buyer = await User.findById(buyer._id);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Phone validation (unit) ────────────────────────────────────────────────
describe('FEAT-11 — phone validation', () => {
  it('accepts E.164-ish numbers and rejects bad ones', () => {
    expect(isValidPhone('+14155550123')).toBe(true);
    expect(isValidPhone('+91 98765 43210')).toBe(true);
    expect(isValidPhone('14155550123')).toBe(false); // missing +
    expect(isValidPhone('+123')).toBe(false); // too short
    expect(isValidPhone('+1234567890123456')).toBe(false); // 16 digits, too long
    expect(isValidPhone('+1-abc-555')).toBe(false);
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone(undefined)).toBe(false);
  });
});

// ── Opt-in gate ────────────────────────────────────────────────────────────
describe('FEAT-11 — opt-in gate', () => {
  const fakeOrder = () => ({ orderNumber: 'HAO-2026-300001', user: buyer._id });

  it('no MessageLog row when the buyer has not opted in (phone present)', async () => {
    await User.updateOne({ _id: buyer._id }, { $set: { phone: BUYER_PHONE } });
    const row = await sendOrderConfirmedWhatsApp(fakeOrder());
    expect(row).toBeNull();
    expect(await MessageLog.countDocuments({})).toBe(0);
  });

  it('no MessageLog row when opted in but no phone on file', async () => {
    await User.updateOne({ _id: buyer._id }, { $set: { 'notifications.whatsapp': true } });
    const row = await sendOrderConfirmedWhatsApp(fakeOrder());
    expect(row).toBeNull();
    expect(await MessageLog.countDocuments({})).toBe(0);
  });

  it('defaults: a fresh user has whatsapp=false and empty phone', async () => {
    const fresh = await User.create(makeUser());
    expect(fresh.notifications.whatsapp).toBe(false);
    expect(fresh.notifications.email).toBe(true);
    expect(fresh.phone).toBe('');
  });
});

// ── Simulated mode (env-gated off) ─────────────────────────────────────────
describe('FEAT-11 — simulated sends when provider keys are absent', () => {
  it('records status simulated with template + payload facts, never sent', async () => {
    await optInBuyer();
    const row = await sendOrderConfirmedWhatsApp({
      orderNumber: 'HAO-2026-300002',
      user: buyer._id,
    });
    expect(row).not.toBeNull();
    expect(row.status).toBe('simulated');
    expect(row.channel).toBe('whatsapp');
    expect(row.template).toBe('order_confirmed_v1');
    expect(row.user.toString()).toBe(buyer._id.toString());
    expect(row.payload.to).toBe(BUYER_PHONE);
    expect(row.payload.parameters).toEqual(['HAO-2026-300002', 'Confirmed']);
    expect(row.error).toBeNull();
  });

  it('only one of the two env vars set still simulates (no fetch call)', async () => {
    process.env.WHATSAPP_TOKEN = 'token-only';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await optInBuyer();
    const row = await sendWhatsAppTemplate({
      user: buyer,
      template: 'order_shipped_v1',
      parameters: ['HAO-2026-300003', 'Shipped'],
    });
    expect(row.status).toBe('simulated');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Meta adapter (mocked fetch) ────────────────────────────────────────────
describe('FEAT-11 — meta adapter request shape', () => {
  beforeEach(() => {
    process.env.WHATSAPP_TOKEN = 'test-wa-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  });

  it('POSTs the template message with correct URL, auth header and payload; 200 → sent', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.TEST123' }] }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchSpy);
    await optInBuyer();

    const row = await sendWhatsAppTemplate({
      user: buyer,
      template: 'order_confirmed_v1',
      parameters: ['HAO-2026-300004', 'Confirmed'],
    });

    expect(row.status).toBe('sent');
    expect(row.payload.providerMessageId).toBe('wamid.TEST123');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-wa-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to: BUYER_PHONE,
      type: 'template',
      template: {
        name: 'order_confirmed_v1',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'HAO-2026-300004' },
              { type: 'text', text: 'Confirmed' },
            ],
          },
        ],
      },
    });
  });

  it('provider non-200 records failed with the error, and does not throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => '{"error":{"message":"bad token"}}',
      }))
    );
    await optInBuyer();
    const row = await sendWhatsAppTemplate({
      user: buyer,
      template: 'order_shipped_v1',
      parameters: ['HAO-2026-300005', 'Shipped'],
    });
    expect(row.status).toBe('failed');
    expect(row.error).toContain('401');
  });

  it('a thrown fetch records failed and does not throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    await optInBuyer();
    const row = await sendWhatsAppTemplate({
      user: buyer,
      template: 'quote_ready_v1',
      parameters: ['HAO-2026-300006', 'Ready'],
    });
    expect(row.status).toBe('failed');
    expect(row.error).toContain('network down');
  });
});

// ── Wiring through the v0.4 notify/outbox services ─────────────────────────
describe('FEAT-11 — order + quote wiring', () => {
  const createOrderViaApi = (token, overrides = {}) =>
    request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [{ productName: 'Test Hammer', sku: 'TST-HMR-001', quantity: 2, unitPrice: 10 }],
        status: 'Submitted',
        orderType: 'Order',
        ...overrides,
      });

  const transition = (orderId, status, extra = {}) =>
    request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status, ...extra });

  it('order Confirmed transition sends order_confirmed_v1 (simulated) + in-app notification', async () => {
    await optInBuyer();
    const created = await createOrderViaApi(buyerToken);
    expect(created.status).toBe(201);
    const orderId = created.body.order._id;

    const res = await transition(orderId, 'Confirmed');
    expect(res.status).toBe(200);

    const logs = await MessageLog.find({ user: buyer._id });
    expect(logs).toHaveLength(1);
    expect(logs[0].template).toBe('order_confirmed_v1');
    expect(logs[0].status).toBe('simulated');
    expect(logs[0].payload.parameters).toEqual([created.body.order.orderNumber, 'Confirmed']);
    // In-app flow unaffected.
    expect(
      await Notification.countDocuments({ user: buyer._id, type: 'order_status_changed' })
    ).toBe(1);
  });

  it('order Shipped transition sends order_shipped_v1 exactly once', async () => {
    await optInBuyer();
    const created = await createOrderViaApi(buyerToken);
    const orderId = created.body.order._id;
    expect((await transition(orderId, 'Confirmed')).status).toBe(200);
    expect((await transition(orderId, 'In Production')).status).toBe(200);
    expect((await transition(orderId, 'Quality Check')).status).toBe(200);
    const shipped = await transition(orderId, 'Shipped', {
      trackingNumber: 'TRK-999',
      carrierName: 'Maersk',
    });
    expect(shipped.status).toBe(200);

    const shippedLogs = await MessageLog.find({ template: 'order_shipped_v1' });
    expect(shippedLogs).toHaveLength(1);
    expect(shippedLogs[0].payload.parameters).toEqual([
      created.body.order.orderNumber,
      'Shipped',
    ]);
  });

  it('a non-opted-in buyer gets notifications but NO MessageLog rows across the lifecycle', async () => {
    const created = await createOrderViaApi(buyerToken);
    const orderId = created.body.order._id;
    expect((await transition(orderId, 'Confirmed')).status).toBe(200);
    expect(await MessageLog.countDocuments({})).toBe(0);
    expect(await Notification.countDocuments({ user: buyer._id })).toBeGreaterThan(0);
  });

  it('provider failure during a status transition records failed and the transition still succeeds', async () => {
    process.env.WHATSAPP_TOKEN = 'test-wa-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('provider unreachable');
      })
    );
    await optInBuyer();
    const created = await createOrderViaApi(buyerToken);
    const orderId = created.body.order._id;

    const res = await transition(orderId, 'Confirmed');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Confirmed');

    const logs = await MessageLog.find({ user: buyer._id });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');
    expect(logs[0].error).toContain('provider unreachable');
    // The in-app notification was still created.
    expect(
      await Notification.countDocuments({ user: buyer._id, type: 'order_status_changed' })
    ).toBe(1);
  });

  it('notifyOrderStatusChanged for a non-template status sends no WhatsApp', async () => {
    await optInBuyer();
    await notifyOrderStatusChanged(
      { orderNumber: 'HAO-2026-300007', user: buyer._id, status: 'In Production' },
      'In Production'
    );
    expect(await MessageLog.countDocuments({})).toBe(0);
    expect(await Notification.countDocuments({ user: buyer._id })).toBe(1);
  });

  it('buyer accepting a quote fans out quote_ready_v1 with the Accepted fact', async () => {
    await optInBuyer();
    const created = await createOrderViaApi(buyerToken, { orderType: 'Quote' });
    expect(created.status).toBe(201);
    const orderId = created.body.order._id;

    const res = await request(app)
      .post(`/api/orders/${orderId}/quote/accept`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({});
    expect(res.status).toBe(200);

    const logs = await MessageLog.find({ user: buyer._id, template: 'quote_ready_v1' });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('simulated');
    expect(logs[0].payload.parameters).toEqual([created.body.order.orderNumber, 'Accepted']);
  });

  it('converting a quote to an order fans out order_confirmed_v1 via the outbox helper', async () => {
    await optInBuyer();
    const created = await createOrderViaApi(buyerToken, { orderType: 'Quote' });
    const orderId = created.body.order._id;

    const res = await request(app)
      .post(`/api/orders/${orderId}/convert-quote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);

    const logs = await MessageLog.find({ user: buyer._id, template: 'order_confirmed_v1' });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('simulated');
  });
});

// ── Profile update: phone + opt-in ─────────────────────────────────────────
describe('FEAT-11 — profile update', () => {
  const updateProfile = (body) =>
    request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send(body);

  it('accepts an E.164 phone and the whatsapp opt-in, and persists both', async () => {
    const res = await updateProfile({
      phone: '+1 416-555-0123',
      notifications: { whatsapp: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.user.phone).toBe('+14165550123');
    expect(res.body.user.notifications.whatsapp).toBe(true);

    const saved = await User.findById(buyer._id);
    expect(saved.phone).toBe('+14165550123');
    expect(saved.notifications.whatsapp).toBe(true);
    // Existing preference untouched.
    expect(saved.notifications.email).toBe(true);
  });

  it('rejects invalid phone numbers with 400 and saves nothing', async () => {
    for (const bad of ['4165550123', '+123', 'not-a-number', '+1234567890123456']) {
      const res = await updateProfile({ phone: bad });
      expect(res.status).toBe(400);
    }
    const saved = await User.findById(buyer._id);
    expect(saved.phone).toBe('');
  });

  it('opt-in without a phone is stored but produces no sends', async () => {
    const res = await updateProfile({ notifications: { whatsapp: true } });
    expect(res.status).toBe(200);
    const row = await sendOrderConfirmedWhatsApp({
      orderNumber: 'HAO-2026-300008',
      user: buyer._id,
    });
    expect(row).toBeNull();
    expect(await MessageLog.countDocuments({})).toBe(0);
  });

  it('an opted-in buyer with a phone set via profile receives simulated sends', async () => {
    await updateProfile({ phone: BUYER_PHONE, notifications: { whatsapp: true } });
    const row = await sendOrderConfirmedWhatsApp({
      orderNumber: 'HAO-2026-300009',
      user: buyer._id,
    });
    expect(row).not.toBeNull();
    expect(row.status).toBe('simulated');
    expect(row.payload.to).toBe(BUYER_PHONE);
  });
});
