/**
 * paymentsV06.test.js — FEAT-03 (v0.6) Payments (env-gated)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import paymentRoutes from '../src/routes/paymentRoutes.js';
import { stripeWebhook } from '../src/controllers/paymentController.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Payment } from '../src/models/Payment.js';
import { EmailOutbox } from '../src/models/EmailOutbox.js';
import { Notification } from '../src/models/Notification.js';
import { generateAccessToken } from '../src/utils/token.js';

function buildTestApp() {
  const app = express();
  // Mirror server.js: raw body for the webhook BEFORE global JSON parser
  app.post('/api/payments/webhook/stripe', express.raw({ type: 'application/json', limit: '100kb' }), stripeWebhook);
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/payments', paymentRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Pay Buyer',
  businessName: 'Pay Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `pay_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'testpassword123',
  role: 'user',
  ...overrides,
});

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64'
);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

let mongod, app, buyer, buyerToken, other, otherToken, staff, staffToken, order;
let orderCounter = 0;
const originalFetch = global.fetch;
const savedEnv = {};

const makeOrder = async () => {
  orderCounter += 1;
  return Order.create({
    orderNumber: `HAO-2026-900${String(orderCounter).padStart(3, '0')}`,
    user: buyer._id,
    customerDetails: { customerName: buyer.customerName, businessName: buyer.businessName, email: buyer.email },
    items: [{ productName: 'Hammer', sku: 'HAM-1', quantity: 1, unitPrice: 100 }],
    totalAmount: 100,
    currency: 'USD',
    status: 'Confirmed',
  });
};

const sign = (payload, secret) => {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
};

beforeAll(async () => {
  for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BANK_TRANSFER_INSTRUCTIONS', 'CLIENT_URL']) savedEnv[k] = process.env[k];
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
  buyer = await User.create(makeUser());
  buyerToken = generateAccessToken(buyer);
  other = await User.create(makeUser());
  otherToken = generateAccessToken(other);
  staff = await User.create(makeUser({ role: 'sales_manager' }));
  staffToken = generateAccessToken(staff);
}, 60000);

afterAll(async () => {
  global.fetch = originalFetch;
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await Payment.deleteMany({});
  await Order.deleteMany({});
  await EmailOutbox.deleteMany({});
  await Notification.deleteMany({});
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.BANK_TRANSFER_INSTRUCTIONS;
  process.env.CLIENT_URL = 'http://localhost:5173';
  global.fetch = originalFetch;
  order = await makeOrder();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('FEAT-03 — card request env gating', () => {
  it('card with STRIPE_SECRET_KEY unset -> 503 PAYMENTS_NOT_CONFIGURED and no dangling payment', async () => {
    const res = await request(app).post('/api/payments/request').set('Authorization', `Bearer ${buyerToken}`).send({ orderId: order._id, amount: 50, method: 'card' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PAYMENTS_NOT_CONFIGURED');
    expect(await Payment.countDocuments({})).toBe(0);
  });

  it('card with mocked fetch -> 201 + checkoutUrl + providerRef stored', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    global.fetch = vi.fn(async (url, opts) => {
      expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
      expect(opts.headers.Authorization).toBe('Bearer sk_test_fake');
      const params = new URLSearchParams(opts.body);
      expect(params.get('metadata[paymentId]')).toBeTruthy();
      expect(params.get('line_items[0][price_data][unit_amount]')).toBe('5000');
      return { ok: true, status: 200, json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/cs_test_123' }) };
    });
    const res = await request(app).post('/api/payments/request').set('Authorization', `Bearer ${buyerToken}`).send({ orderId: order._id, amount: 50, method: 'card' });
    expect(res.status).toBe(201);
    expect(res.body.data.checkoutUrl).toBe('https://checkout.stripe.com/c/cs_test_123');
    expect(res.body.data.payment.providerRef).toBe('cs_test_123');
    const stored = await Payment.findById(res.body.data.payment._id);
    expect(stored.providerRef).toBe('cs_test_123');
    expect(stored.status).toBe('initiated');
  });
});

describe('FEAT-03 — bank transfer + proof + confirm/reject', () => {
  it('bank_transfer -> pending_proof + instructions', async () => {
    process.env.BANK_TRANSFER_INSTRUCTIONS = 'Wire to account 123';
    const res = await request(app).post('/api/payments/request').set('Authorization', `Bearer ${buyerToken}`).send({ orderId: order._id, amount: 100, method: 'bank_transfer' });
    expect(res.status).toBe(201);
    expect(res.body.data.payment.status).toBe('pending_proof');
    expect(res.body.data.instructions).toBe('Wire to account 123');
  });

  it('proof upload (PNG) -> proof_submitted; PDF also accepted; confirm by staff fires notification+email', async () => {
    const created = await request(app).post('/api/payments/request').set('Authorization', `Bearer ${buyerToken}`).send({ orderId: order._id, amount: 100, method: 'bank_transfer' });
    const payId = created.body.data.payment._id;
    const res = await request(app).post(`/api/payments/${payId}/proof`).set('Authorization', `Bearer ${buyerToken}`).attach('proof', PNG_BYTES, { filename: 'proof.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('proof_submitted');
    expect(res.body.data.payment.proofFile).toMatch(/^pay_.*\.png$/);
    // cleanup stored file
    const filePath = path.join(process.cwd(), 'uploads', res.body.data.payment.proofFile);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const confirm = await request(app).post(`/api/payments/${payId}/confirm`).set('Authorization', `Bearer ${staffToken}`).send({});
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.payment.status).toBe('confirmed');
    expect(confirm.body.data.payment.confirmedBy).toBe(staff._id.toString());
    expect(confirm.body.data.payment.confirmedAt).toBeTruthy();
    expect(await Notification.countDocuments({ user: buyer._id, type: 'payment_received' })).toBe(1);
    const outbox = await EmailOutbox.find({ template: 'payment_received' });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload.amount).toBe(100);
    expect(outbox[0].payload.orderNumber).toBe(order.orderNumber);
  });

  it('proof upload accepts PDF bytes', async () => {
    const created = await request(app).post('/api/payments/request').set('Authorization', `Bearer ${buyerToken}`).send({ orderId: order._id, amount: 10, method: 'bank_transfer' });
    const payId = created.body.data.payment._id;
    const res = await request(app).post(`/api/payments/${payId}/proof`).set('Authorization', `Bearer ${buyerToken}`).attach('proof', PDF_BYTES, { filename: 'proof.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.data.payment.proofFile).toMatch(/\.pdf$/);
    const filePath = path.join(process.cwd(), 'uploads', res.body.data.payment.proofFile);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('reject by staff -> failed + reason + buyer notified', async () => {
    const created = await request(app).post('/api/payments/request').set('Authorization', `Bearer ${buyerToken}`).send({ orderId: order._id, amount: 10, method: 'bank_transfer' });
    const payId = created.body.data.payment._id;
    const res = await request(app).post(`/api/payments/${payId}/reject`).set('Authorization', `Bearer ${staffToken}`).send({ reason: 'Blurry proof' });
    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('failed');
    expect(res.body.data.payment.rejectReason).toBe('Blurry proof');
    expect(await Notification.countDocuments({ user: buyer._id, type: 'payment_failed' })).toBe(1);
    // buyer cannot confirm/reject (staff only)
    const buyerConfirm = await request(app).post(`/api/payments/${payId}/confirm`).set('Authorization', `Bearer ${buyerToken}`).send({});
    expect(buyerConfirm.status).toBe(403);
  });
});

describe('FEAT-03 — ownership', () => {
  it('another buyer -> 404 on request, proof, and list', async () => {
    const reqRes = await request(app).post('/api/payments/request').set('Authorization', `Bearer ${otherToken}`).send({ orderId: order._id, amount: 10, method: 'bank_transfer' });
    expect(reqRes.status).toBe(404);

    const created = await request(app).post('/api/payments/request').set('Authorization', `Bearer ${buyerToken}`).send({ orderId: order._id, amount: 10, method: 'bank_transfer' });
    const payId = created.body.data.payment._id;
    const proofRes = await request(app).post(`/api/payments/${payId}/proof`).set('Authorization', `Bearer ${otherToken}`).attach('proof', PNG_BYTES, { filename: 'p.png', contentType: 'image/png' });
    expect(proofRes.status).toBe(404);

    const listRes = await request(app).get(`/api/payments/order/${order._id}`).set('Authorization', `Bearer ${otherToken}`);
    expect(listRes.status).toBe(404);

    const okList = await request(app).get(`/api/payments/order/${order._id}`).set('Authorization', `Bearer ${buyerToken}`);
    expect(okList.status).toBe(200);
    expect(okList.body.total).toBe(1);
    expect(okList.body.data[0]._id).toBe(payId);
  });

  it('validates amount > 0', async () => {
    const res = await request(app).post('/api/payments/request').set('Authorization', `Bearer ${buyerToken}`).send({ orderId: order._id, amount: 0, method: 'bank_transfer' });
    expect(res.status).toBe(400);
  });
});

describe('FEAT-03 — Stripe webhook', () => {
  const setupCardPayment = async () => {
    const p = await Payment.create({ order: order._id, buyer: buyer._id, amount: 50, currency: 'USD', method: 'card', status: 'initiated', providerRef: 'cs_test_999', createdBy: buyer._id });
    return p;
  };

  it('no webhook secret -> 501', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_999' } } });
    const res = await request(app).post('/api/payments/webhook/stripe').set('Content-Type', 'application/json').set('stripe-signature', sign(payload, 'whsec_x')).send(payload);
    expect(res.status).toBe(501);
  });

  it('bad signature -> 400', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    await setupCardPayment();
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_999' } } });
    const res = await request(app).post('/api/payments/webhook/stripe').set('Content-Type', 'application/json').set('stripe-signature', sign(payload, 'wrong_secret')).send(payload);
    expect(res.status).toBe(400);
    expect((await Payment.findOne({ providerRef: 'cs_test_999' })).status).toBe('initiated');
  });

  it('valid signature -> confirms; replay is idempotent (no duplicate notification/email)', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const p = await setupCardPayment();
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_999' } } });
    const sig = sign(payload, 'whsec_test');
    const res = await request(app).post('/api/payments/webhook/stripe').set('Content-Type', 'application/json').set('stripe-signature', sig).send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const after = await Payment.findById(p._id);
    expect(after.status).toBe('confirmed');
    expect(after.confirmedAt).toBeTruthy();
    expect(await Notification.countDocuments({ type: 'payment_received' })).toBe(1);
    expect(await EmailOutbox.countDocuments({ template: 'payment_received' })).toBe(1);

    // Replay — need fresh timestamp signature over same payload
    const res2 = await request(app).post('/api/payments/webhook/stripe').set('Content-Type', 'application/json').set('stripe-signature', sign(payload, 'whsec_test')).send(payload);
    expect(res2.status).toBe(200);
    expect(await Notification.countDocuments({ type: 'payment_received' })).toBe(1);
    expect(await EmailOutbox.countDocuments({ template: 'payment_received' })).toBe(1);
    expect((await Payment.findById(p._id)).status).toBe('confirmed');
  });

  it('verified event for unknown session -> 200 received', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_unknown' } } });
    const res = await request(app).post('/api/payments/webhook/stripe').set('Content-Type', 'application/json').set('stripe-signature', sign(payload, 'whsec_test')).send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
