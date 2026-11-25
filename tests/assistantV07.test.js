/**
 * assistantV07.test.js
 * FEAT-16 (v0.7) — AI Order Desk Assistant Stages 1+2:
 * rules intents, cross-user refusal, daily cap, provider fallback,
 * redaction, handoff outbox, TTL index, auth.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';

process.env.JWT_SECRET = 'assistant-v07-test-secret-0123456789abcdef';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import assistantRoutes from '../src/routes/assistantRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { Invoice } from '../src/models/Invoice.js';
import { EmailOutbox } from '../src/models/EmailOutbox.js';
import { AssistantConversation } from '../src/models/AssistantConversation.js';
import { generateAccessToken } from '../src/utils/token.js';
import { executeToolByName } from '../src/services/assistant/tools.js';
import { redactForProvider } from '../src/services/assistant/redact.js';
import { KNOWLEDGE } from '../src/services/assistant/knowledge.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/assistant', assistantRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Assistant Buyer',
  businessName: 'Assistant Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0199',
  address: '99 Secret Lane',
  username: `ast_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `ast_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'testpassword123',
  role: 'user',
  ...overrides,
});

let mongod;
let app;
let buyerA, tokenA;
let buyerB, tokenB;
let product;
let orderA;
const originalFetch = globalThis.fetch;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const sendMsg = (token, message, extra = {}) =>
  request(app).post('/api/assistant/message').set(auth(token)).send({ message, ...extra });

beforeAll(async () => {
  delete process.env.ASSISTANT_PROVIDER;
  delete process.env.ASSISTANT_MODEL;
  delete process.env.ASSISTANT_DAILY_CAP;
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();

  buyerA = await User.create(makeUser({ distributorTier: 'Gold' }));
  tokenA = generateAccessToken(buyerA);
  buyerB = await User.create(makeUser({ distributorTier: 'Standard' }));
  tokenB = generateAccessToken(buyerB);

  product = await Product.create({
    name: 'Claw Hammer',
    sku: 'AST-HMR-001',
    category: 'Hand Tools',
    description: 'Forged steel claw hammer',
    basePrice: 100,
    currency: 'USD',
    moq: 50,
    isActive: true,
  });

  orderA = await Order.create({
    orderNumber: 'HAO-2026-900001',
    orderType: 'Order',
    user: buyerA._id,
    customerDetails: {
      customerName: buyerA.customerName,
      businessName: buyerA.businessName,
      country: buyerA.country,
      phoneNumber: buyerA.phoneNumber,
      address: buyerA.address,
      email: buyerA.email,
    },
    items: [{ productName: 'Claw Hammer', sku: 'AST-HMR-001', quantity: 10, unitPrice: 50, totalPrice: 500 }],
    totalQuantity: 10,
    totalAmount: 500,
    currency: 'USD',
    status: 'Shipped',
    carrierName: 'DHL',
    trackingNumber: 'DHL-SECRET-1',
    timeline: [
      { status: 'Submitted', updatedBy: 'buyer', updatedAt: new Date('2026-11-01T10:00:00Z') },
      { status: 'Shipped', updatedBy: 'staff', updatedAt: new Date('2026-11-05T10:00:00Z') },
    ],
  });

  await Invoice.create({
    invoiceNumber: 'INV-900001',
    status: 'partial',
    order: orderA._id,
    user: buyerA._id,
    customerDetails: { customerName: buyerA.customerName, email: buyerA.email },
    items: [],
    currency: 'USD',
    grandTotal: 500,
    amountPaid: 200,
    balanceDue: 300,
  });
}, 60000);

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await AssistantConversation.deleteMany({});
  await EmailOutbox.deleteMany({});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.ASSISTANT_PROVIDER;
  delete process.env.ASSISTANT_DAILY_CAP;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ASSISTANT_MODEL;
  vi.restoreAllMocks();
});

describe('rules intents', () => {
  it('track-order returns the user own order status', async () => {
    const res = await sendMsg(tokenA, `Where is my order ${orderA.orderNumber}?`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reply).toContain(orderA.orderNumber);
    expect(res.body.reply).toContain('Shipped');
    expect(res.body.conversationId).toBeTruthy();
  });

  it('find-product returns matching products', async () => {
    const res = await sendMsg(tokenA, 'Find hammer');
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain('Claw Hammer');
    expect(res.body.reply).toContain('AST-HMR-001');
  });

  it('price estimate matches basePrice x (1 - tierDiscount) x qty', async () => {
    // Gold tier = 12% => unit 88.00, x100 = 8800.00
    const res = await sendMsg(tokenA, 'What is the price for 100 Claw Hammer?');
    expect(res.status).toBe(200);
    expect(res.body.reply.toLowerCase()).toContain('indicative');
    expect(res.body.reply).toContain('88.00');
    expect(res.body.reply).toContain('8800.00');

    const direct = await executeToolByName(buyerA, 'estimate_price', {
      productId: product._id.toString(),
      quantity: 100,
    });
    expect(direct.unitPrice).toBe(88);
    expect(direct.lineTotal).toBe(8800);
  });

  it('FAQ returns the knowledge answer verbatim', async () => {
    const entry = KNOWLEDGE.find((k) => k.id === 'lead-time');
    const res = await sendMsg(tokenA, 'What is your lead time?');
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe(entry.answer);
  });

  it('invoice question returns stored totals', async () => {
    const res = await sendMsg(tokenA, `Show invoice for order ${orderA.orderNumber}`);
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain('INV-900001');
    expect(res.body.reply).toContain('300.00');
  });

  it('gibberish gets graceful fallback with chips + handoff offer', async () => {
    const res = await sendMsg(tokenA, 'asdfqwer zxcvbn plokm');
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain("didn't quite understand");
    expect(res.body.reply.toLowerCase()).toContain('human follow-up');
    expect(Array.isArray(res.body.chips)).toBe(true);
    expect(res.body.chips.length).toBeGreaterThan(0);
  });

  it('list orders returns own orders', async () => {
    const res = await sendMsg(tokenA, 'Show my orders');
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain(orderA.orderNumber);
  });
});

describe('cross-user safety', () => {
  it('tool get_order_status refuses another user order with no data', async () => {
    const result = await executeToolByName(buyerB, 'get_order_status', {
      orderId: orderA._id.toString(),
    });
    expect(result).toEqual({ error: 'not_found_or_not_yours' });
    const invoiceResult = await executeToolByName(buyerB, 'get_invoice_summary', {
      orderId: orderA._id.toString(),
    });
    expect(invoiceResult).toEqual({ error: 'not_found_or_not_yours' });
  });

  it('user B asking about user A order gets refusal and none of A data', async () => {
    const res = await sendMsg(tokenB, `Where is my order ${orderA.orderNumber}?`);
    expect(res.status).toBe(200);
    expect(res.body.reply).not.toContain('Shipped');
    expect(res.body.reply).not.toContain('DHL-SECRET-1');
    expect(res.body.reply).not.toContain('500');
    // Also by ObjectId
    const res2 = await sendMsg(tokenB, `Track order ${orderA._id.toString()}`);
    expect(res2.body.reply).not.toContain('Shipped');
    expect(res2.body.reply).not.toContain(orderA.orderNumber);
  });

  it('conversation belonging to another user is 404 for message/feedback/delete', async () => {
    const created = await sendMsg(tokenA, 'Find hammer');
    const cid = created.body.conversationId;
    const cont = await sendMsg(tokenB, 'Find hammer', { conversationId: cid });
    expect(cont.status).toBe(404);
    const fb = await request(app).post('/api/assistant/feedback').set(auth(tokenB)).send({ conversationId: cid, rating: 'up' });
    expect(fb.status).toBe(404);
    const del = await request(app).delete(`/api/assistant/conversations/${cid}`).set(auth(tokenB));
    expect(del.status).toBe(404);
    // Owner can feedback + delete
    const fbOk = await request(app).post('/api/assistant/feedback').set(auth(tokenA)).send({ conversationId: cid, rating: 'up', messageIndex: 1 });
    expect(fbOk.status).toBe(200);
    const convo = await AssistantConversation.findById(cid);
    expect(convo.feedback).toHaveLength(1);
    expect(convo.feedback[0].rating).toBe('up');
    const delOk = await request(app).delete(`/api/assistant/conversations/${cid}`).set(auth(tokenA));
    expect(delOk.status).toBe(200);
    expect(await AssistantConversation.findById(cid)).toBeNull();
  });
});

describe('daily cap + provider fallback', () => {
  it('after cap, reply is rules/cap notice even with gemini + failing fetch', async () => {
    const fresh = await User.create(makeUser());
    const freshToken = generateAccessToken(fresh);
    process.env.ASSISTANT_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    process.env.ASSISTANT_DAILY_CAP = '1';
    globalThis.fetch = vi.fn(async () => { throw new Error('network down'); });

    const first = await sendMsg(freshToken, 'What is your lead time?');
    expect(first.status).toBe(200);
    expect(first.body.reply).not.toMatch(/daily assistant limit/i);

    const second = await sendMsg(freshToken, 'What is your lead time?');
    expect(second.status).toBe(200);
    expect(second.body.reply).toMatch(/daily assistant limit/i);
  });

  it('gemini with mocked rejecting fetch still succeeds via rules', async () => {
    const fresh = await User.create(makeUser());
    const freshToken = generateAccessToken(fresh);
    process.env.ASSISTANT_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key-not-real';
    process.env.ASSISTANT_DAILY_CAP = '50';
    globalThis.fetch = vi.fn(async () => { throw new Error('boom'); });
    const res = await sendMsg(freshToken, 'What is your lead time?');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const entry = KNOWLEDGE.find((k) => k.id === 'lead-time');
    expect(res.body.reply).toContain(entry.answer.slice(0, 40));
  });
});

describe('redactForProvider', () => {
  it('strips nested phone/email/address, leaves other fields intact, does not mutate', () => {
    const input = {
      orderNumber: 'HAO-1',
      totalAmount: 500,
      customer: { email: 'a@b.com', phoneNumber: '+1-555', name: 'Buyer', nested: { address: '1 St', mobile: '123', city: 'Ottawa' } },
      list: [{ telephone: '999', sku: 'X-1' }, { contactEmailAddress: 'x@y.z', qty: 2 }],
    };
    const out = redactForProvider(input);
    expect(out.orderNumber).toBe('HAO-1');
    expect(out.totalAmount).toBe(500);
    expect(out.customer.email).toBe('[REDACTED]');
    expect(out.customer.phoneNumber).toBe('[REDACTED]');
    expect(out.customer.name).toBe('Buyer');
    expect(out.customer.nested.address).toBe('[REDACTED]');
    expect(out.customer.nested.mobile).toBe('[REDACTED]');
    expect(out.customer.nested.city).toBe('Ottawa');
    expect(out.list[0].telephone).toBe('[REDACTED]');
    expect(out.list[0].sku).toBe('X-1');
    expect(out.list[1].qty).toBe(2);
    // original untouched
    expect(input.customer.email).toBe('a@b.com');
  });
});

describe('handoff, faq, TTL, auth', () => {
  it('handoff endpoint creates EmailOutbox row to support address', async () => {
    process.env.SUPPORT_EMAIL = 'support@test.example.com';
    try {
      const res = await request(app)
        .post('/api/assistant/handoff')
        .set(auth(tokenA))
        .send({ transcript: 'user: I need help with my shipment', note: 'Please call me' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, ok: true });
      const rows = await EmailOutbox.find({ template: 'assistantHandoff' });
      expect(rows).toHaveLength(1);
      expect(rows[0].to).toBe('support@test.example.com');
      expect(rows[0].payload.transcript).toContain('shipment');
      expect(rows[0].payload.customerEmail).toBe(buyerA.email);
    } finally {
      delete process.env.SUPPORT_EMAIL;
    }
  });

  it('request_human_followup tool + human intent enqueues handoff', async () => {
    process.env.SUPPORT_EMAIL = 'support@test.example.com';
    try {
      const res = await sendMsg(tokenA, 'Can I talk to a human please?');
      expect(res.status).toBe(200);
      expect(res.body.reply.toLowerCase()).toContain('human follow-up');
      const rows = await EmailOutbox.find({ template: 'assistantHandoff' });
      expect(rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env.SUPPORT_EMAIL;
    }
  });

  it('GET /faq returns version + entries', async () => {
    const res = await request(app).get('/api/assistant/faq').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.version).toBeTruthy();
    expect(res.body.data.length).toBe(KNOWLEDGE.length);
  });

  it('TTL index exists on AssistantConversation schema (30 days)', () => {
    const indexes = AssistantConversation.schema.indexes();
    const ttl = indexes.find(([, opts]) => opts && opts.expireAfterSeconds);
    expect(ttl).toBeTruthy();
    expect(ttl[1].expireAfterSeconds).toBe(30 * 24 * 3600);
    expect(Object.keys(ttl[0])).toContain('updatedAt');
  });

  it('unauthenticated requests get 401', async () => {
    expect((await request(app).post('/api/assistant/message').send({ message: 'hi' })).status).toBe(401);
    expect((await request(app).get('/api/assistant/faq')).status).toBe(401);
    expect((await request(app).post('/api/assistant/handoff').send({ transcript: 'x' })).status).toBe(401);
    expect((await request(app).post('/api/assistant/feedback').send({ conversationId: 'x', rating: 'up' })).status).toBe(401);
  });
});
