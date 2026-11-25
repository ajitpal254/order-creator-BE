/**
 * quotesV05.test.js
 * FEAT-02 (v0.5) — quote workflow:
 * - Order model additive quote fields (validity, version, quoteStatus,
 *   counterOffers subdocuments).
 * - POST /api/orders/:id/counter-offer (buyer-owner only; SEC-01 404
 *   for another buyer; staff 403; only Quote + Draft/Submitted).
 * - POST /api/orders/:id/counter-offer/:offerId/respond (staff only;
 *   accept applies the amount to totalAmount, bumps quoteVersion,
 *   declines other pending offers, sets validity; decline leaves the
 *   quote untouched).
 * - POST /api/orders/:id/quote/accept|decline (buyer-owner only; sets
 *   quoteStatus WITHOUT changing the order status state machine field).
 * - GET /api/orders/:id/quote-pdf (owner or staff; 404 for another
 *   buyer; 400 for a non-quote order; application/pdf).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { EmailOutbox } from '../src/models/EmailOutbox.js';
import { Notification } from '../src/models/Notification.js';
import { generateAccessToken } from '../src/utils/token.js';
import { generateQuotePdf } from '../src/utils/quotePdf.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/orders', orderRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Quote Buyer',
  businessName: 'Quote Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `quote_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `quote_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'testpassword123',
  role: 'user',
  ...overrides,
});

let mongod;
let app;
let buyer, buyerToken;
let other, otherToken;
let admin, adminToken;
let seq = 0;

const makeQuote = async (owner, overrides = {}) => {
  seq += 1;
  return Order.create({
    orderNumber: `RFQ-2026-${300000 + seq}`,
    orderType: 'Quote',
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
    status: 'Submitted',
    ...overrides,
  });
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

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
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await Order.deleteMany({});
  await EmailOutbox.deleteMany({});
  await Notification.deleteMany({});
});

// ── Model defaults ─────────────────────────────────────────────────────────
describe('FEAT-02 — quote model fields', () => {
  it('defaults quoteVersion=1, quoteStatus=open, empty counterOffers', async () => {
    const quote = await makeQuote(buyer);
    expect(quote.quoteVersion).toBe(1);
    expect(quote.quoteStatus).toBe('open');
    expect(quote.quoteValidityDate).toBeNull();
    expect(quote.counterOffers).toHaveLength(0);
  });
});

// ── Counter-offer creation ─────────────────────────────────────────────────
describe('FEAT-02 — create counter-offer', () => {
  it('buyer-owner creates a pending counter-offer and gets notified', async () => {
    const quote = await makeQuote(buyer);
    const res = await request(app)
      .post(`/api/orders/${quote._id}/counter-offer`)
      .set(auth(buyerToken))
      .send({ amount: 85, message: 'Can you do 85?' });
    expect(res.status).toBe(201);
    expect(res.body.counterOffer.amount).toBe(85);
    expect(res.body.counterOffer.status).toBe('pending');
    expect(res.body.counterOffer.by).toBe(buyer._id.toString());

    const saved = await Order.findById(quote._id);
    expect(saved.counterOffers).toHaveLength(1);

    const notifs = await Notification.find({ user: buyer._id, type: 'counter_offer_created' });
    expect(notifs).toHaveLength(1);
    // Buyer confirmation email + staff (admin address) alert via outbox.
    const rows = await EmailOutbox.find({ template: 'counter_offer_received' });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((r) => r.to)).toContain(buyer.email);
  });

  it('another buyer gets 404 (SEC-01), staff gets 403', async () => {
    const quote = await makeQuote(buyer);
    const otherRes = await request(app)
      .post(`/api/orders/${quote._id}/counter-offer`)
      .set(auth(otherToken))
      .send({ amount: 50 });
    expect(otherRes.status).toBe(404);

    const staffRes = await request(app)
      .post(`/api/orders/${quote._id}/counter-offer`)
      .set(auth(adminToken))
      .send({ amount: 50 });
    expect(staffRes.status).toBe(403);
    expect((await Order.findById(quote._id)).counterOffers).toHaveLength(0);
  });

  it('rejects a non-quote order and a non-quotable status', async () => {
    const plainOrder = await makeQuote(buyer, { orderType: 'Order' });
    const res1 = await request(app)
      .post(`/api/orders/${plainOrder._id}/counter-offer`)
      .set(auth(buyerToken))
      .send({ amount: 50 });
    expect(res1.status).toBe(400);

    const confirmed = await makeQuote(buyer, { status: 'Confirmed' });
    const res2 = await request(app)
      .post(`/api/orders/${confirmed._id}/counter-offer`)
      .set(auth(buyerToken))
      .send({ amount: 50 });
    expect(res2.status).toBe(400);
  });

  it('rejects a non-positive amount via validation', async () => {
    const quote = await makeQuote(buyer);
    const res = await request(app)
      .post(`/api/orders/${quote._id}/counter-offer`)
      .set(auth(buyerToken))
      .send({ amount: -5 });
    expect(res.status).toBe(400);
  });
});

// ── Counter-offer respond ──────────────────────────────────────────────────
describe('FEAT-02 — respond to counter-offer', () => {
  const seedTwoOffers = async () => {
    const quote = await makeQuote(buyer);
    for (const amount of [90, 85]) {
      const res = await request(app)
        .post(`/api/orders/${quote._id}/counter-offer`)
        .set(auth(buyerToken))
        .send({ amount });
      expect(res.status).toBe(201);
    }
    const saved = await Order.findById(quote._id);
    return { quote: saved, offers: saved.counterOffers };
  };

  it('staff accept applies the amount, bumps quoteVersion, declines other pending offers, sets validity', async () => {
    const { quote, offers } = await seedTwoOffers();
    await EmailOutbox.deleteMany({});

    const res = await request(app)
      .post(`/api/orders/${quote._id}/counter-offer/${offers[1]._id}/respond`)
      .set(auth(adminToken))
      .send({ accept: true, validityDays: 30 });
    expect(res.status).toBe(200);

    const saved = await Order.findById(quote._id);
    expect(saved.totalAmount).toBe(85);
    expect(saved.quoteVersion).toBe(2);
    expect(saved.quoteValidityDate).not.toBeNull();
    expect(saved.quoteValidityDate.getTime()).toBeGreaterThan(Date.now());
    const byId = Object.fromEntries(saved.counterOffers.map((o) => [o._id.toString(), o.status]));
    expect(byId[offers[1]._id.toString()]).toBe('accepted');
    expect(byId[offers[0]._id.toString()]).toBe('declined');

    // Buyer notified + responded email + revised quote_ready email.
    expect(await Notification.countDocuments({ user: buyer._id, type: 'counter_offer_responded' })).toBe(1);
    expect(await EmailOutbox.countDocuments({ template: 'counter_offer_responded' })).toBe(1);
    expect(await EmailOutbox.countDocuments({ template: 'quote_ready' })).toBe(1);
  });

  it('staff decline marks only that offer declined and leaves the quote untouched', async () => {
    const { quote, offers } = await seedTwoOffers();
    const res = await request(app)
      .post(`/api/orders/${quote._id}/counter-offer/${offers[0]._id}/respond`)
      .set(auth(adminToken))
      .send({ accept: false });
    expect(res.status).toBe(200);

    const saved = await Order.findById(quote._id);
    expect(saved.totalAmount).toBe(100);
    expect(saved.quoteVersion).toBe(1);
    const byId = Object.fromEntries(saved.counterOffers.map((o) => [o._id.toString(), o.status]));
    expect(byId[offers[0]._id.toString()]).toBe('declined');
    expect(byId[offers[1]._id.toString()]).toBe('pending');
  });

  it('a non-staff buyer cannot respond', async () => {
    const { quote, offers } = await seedTwoOffers();
    const res = await request(app)
      .post(`/api/orders/${quote._id}/counter-offer/${offers[0]._id}/respond`)
      .set(auth(buyerToken))
      .send({ accept: true });
    expect(res.status).toBe(403);
  });

  it('responding to a missing offer returns 404, and re-responding returns 400', async () => {
    const { quote, offers } = await seedTwoOffers();
    const missing = await request(app)
      .post(`/api/orders/${quote._id}/counter-offer/${new mongoose.Types.ObjectId()}/respond`)
      .set(auth(adminToken))
      .send({ accept: true });
    expect(missing.status).toBe(404);

    await request(app)
      .post(`/api/orders/${quote._id}/counter-offer/${offers[0]._id}/respond`)
      .set(auth(adminToken))
      .send({ accept: false });
    const again = await request(app)
      .post(`/api/orders/${quote._id}/counter-offer/${offers[0]._id}/respond`)
      .set(auth(adminToken))
      .send({ accept: true });
    expect(again.status).toBe(400);
  });
});

// ── Quote accept / decline ─────────────────────────────────────────────────
describe('FEAT-02 — quote accept / decline', () => {
  it('accept sets quoteStatus=accepted WITHOUT changing order status', async () => {
    const quote = await makeQuote(buyer);
    const res = await request(app)
      .post(`/api/orders/${quote._id}/quote/accept`)
      .set(auth(buyerToken))
      .send({});
    expect(res.status).toBe(200);
    const saved = await Order.findById(quote._id);
    expect(saved.quoteStatus).toBe('accepted');
    expect(saved.quoteAcceptedAt).not.toBeNull();
    // The state machine has no buyer Submitted->Confirmed path; the
    // order status must be untouched (staff convert-quote does that).
    expect(saved.status).toBe('Submitted');
    expect(await Notification.countDocuments({ user: buyer._id, type: 'quote_accepted' })).toBe(1);
    expect(await EmailOutbox.countDocuments({ template: 'quote_accepted' })).toBeGreaterThanOrEqual(1);
  });

  it('decline sets quoteStatus=declined and stores the reason', async () => {
    const quote = await makeQuote(buyer);
    const res = await request(app)
      .post(`/api/orders/${quote._id}/quote/decline`)
      .set(auth(buyerToken))
      .send({ reason: 'Too expensive' });
    expect(res.status).toBe(200);
    const saved = await Order.findById(quote._id);
    expect(saved.quoteStatus).toBe('declined');
    expect(saved.quoteDeclineReason).toBe('Too expensive');
    expect(saved.status).toBe('Submitted');
  });

  it('another buyer gets 404 on accept and decline; staff gets 403 on accept', async () => {
    const quote = await makeQuote(buyer);
    const acceptOther = await request(app)
      .post(`/api/orders/${quote._id}/quote/accept`)
      .set(auth(otherToken))
      .send({});
    expect(acceptOther.status).toBe(404);
    const declineOther = await request(app)
      .post(`/api/orders/${quote._id}/quote/decline`)
      .set(auth(otherToken))
      .send({});
    expect(declineOther.status).toBe(404);
    const acceptStaff = await request(app)
      .post(`/api/orders/${quote._id}/quote/accept`)
      .set(auth(adminToken))
      .send({});
    expect(acceptStaff.status).toBe(403);
    expect((await Order.findById(quote._id)).quoteStatus).toBe('open');
  });
});

// ── Quote PDF ──────────────────────────────────────────────────────────────
describe('FEAT-02 — quote PDF', () => {
  const getPdf = (id, token) =>
    request(app)
      .get(`/api/orders/${id}/quote-pdf`)
      .set(auth(token))
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

  it('generateQuotePdf returns a real PDF buffer', async () => {
    const quote = await makeQuote(buyer, { quoteValidityDate: new Date('2026-12-31') });
    const buf = await generateQuotePdf(quote);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('owner and staff can download; content-type is application/pdf', async () => {
    const quote = await makeQuote(buyer);
    const ownerRes = await getPdf(quote._id, buyerToken);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.headers['content-type']).toContain('application/pdf');
    expect(ownerRes.headers['content-disposition']).toContain('attachment');
    expect(ownerRes.body.subarray(0, 4).toString()).toBe('%PDF');

    const staffRes = await getPdf(quote._id, adminToken);
    expect(staffRes.status).toBe(200);
  });

  it('another buyer gets 404', async () => {
    const quote = await makeQuote(buyer);
    const res = await request(app)
      .get(`/api/orders/${quote._id}/quote-pdf`)
      .set(auth(otherToken));
    expect(res.status).toBe(404);
  });

  it('a non-quote order is rejected with 400', async () => {
    const plainOrder = await makeQuote(buyer, { orderType: 'Order' });
    const res = await request(app)
      .get(`/api/orders/${plainOrder._id}/quote-pdf`)
      .set(auth(buyerToken));
    expect(res.status).toBe(400);
  });
});
