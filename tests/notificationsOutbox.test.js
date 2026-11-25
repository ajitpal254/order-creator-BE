/**
 * notificationsOutbox.test.js
 * FEAT-01 (v0.4) — transactional email outbox + in-app notifications:
 * - enqueueEmail creates a pending EmailOutbox row; processOutbox with
 *   SMTP unset marks it 'simulated' (honest terminal state, NOT 'sent').
 * - Failed sends retry with exponential backoff and become 'failed'
 *   after 5 attempts.
 * - A user with notifications.email=false gets no outbox row.
 * - /api/notifications: own-only listing, unread-count, PATCH read
 *   (404 for another user's), read-all, 401 when unauthenticated.
 * - Order wiring: creating an order enqueues order_received + creates
 *   a notification; a status transition enqueues order_status_changed;
 *   shipping enqueues order_shipped with carrier/tracking payload.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';

// Stub only the raw transport: the rest of emailService (the direct
// helpers orderController still calls) keeps its real behaviour.
const mailMock = vi.hoisted(() => ({ impl: null, actual: null }));
vi.mock('../src/utils/emailService.js', async (importOriginal) => {
  const actual = await importOriginal();
  mailMock.actual = actual.sendRawMail;
  mailMock.impl = actual.sendRawMail;
  return { ...actual, sendRawMail: (...args) => mailMock.impl(...args) };
});

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import notificationRoutes from '../src/routes/notificationRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { EmailOutbox } from '../src/models/EmailOutbox.js';
import { Notification } from '../src/models/Notification.js';
import { generateAccessToken } from '../src/utils/token.js';
import {
  enqueueEmail,
  enqueuePaymentReceived,
  enqueueQuoteReady,
  processOutbox,
  MAX_OUTBOX_ATTEMPTS,
} from '../src/services/outbox.js';
import { notify } from '../src/services/notify.js';
import { renderEmailTemplate } from '../src/utils/emailTemplates.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/orders', orderRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Comms Buyer',
  businessName: 'Comms Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `comms_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `comms_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'testpassword123',
  role: 'user',
  ...overrides,
});

let mongod;
let app;
let buyer, buyerToken;
let other;
let admin, adminToken;

beforeAll(async () => {
  // Guarantee the simulated mail path for the real-transport tests.
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
  buyer = await User.create(makeUser());
  buyerToken = generateAccessToken(buyer);
  other = await User.create(makeUser());
  admin = await User.create(makeUser({ role: 'admin' }));
  adminToken = generateAccessToken(admin);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  mailMock.impl = mailMock.actual;
  await EmailOutbox.deleteMany({});
  await Notification.deleteMany({});
  await Order.deleteMany({});
  await User.updateOne({ _id: buyer._id }, { $set: { 'notifications.email': true } });
  buyer = await User.findById(buyer._id);
});

// ── Templates ──────────────────────────────────────────────────────────────
describe('FEAT-01 — email templates', () => {
  it('renders all six templates with subject/text/html', () => {
    for (const name of [
      'order_received',
      'order_confirmed',
      'order_status_changed',
      'order_shipped',
      'quote_ready',
      'payment_received',
    ]) {
      const out = renderEmailTemplate(name, {
        orderNumber: 'HAO-2026-100001',
        customerName: 'Comms Buyer',
        newStatus: 'Confirmed',
        totalAmount: 120,
        amount: 50,
      });
      expect(out.subject).toContain('HAO-2026-100001');
      expect(out.text.length).toBeGreaterThan(0);
      expect(out.html).toContain('#0f172a');
      expect(out.html).toContain('#f59e0b');
    }
  });

  it('order_shipped includes carrier + tracking number when present', () => {
    const out = renderEmailTemplate('order_shipped', {
      orderNumber: 'HAO-2026-100002',
      carrier: 'Maersk',
      trackingNumber: 'TRK-123',
    });
    expect(out.html).toContain('Maersk');
    expect(out.html).toContain('TRK-123');
    expect(out.text).toContain('TRK-123');
  });
});

// ── Outbox: enqueue + simulated processing ─────────────────────────────────
describe('FEAT-01 — outbox enqueue and simulated send', () => {
  it('enqueue creates a pending row with the rendered subject', async () => {
    const row = await enqueueEmail({
      to: buyer.email,
      template: 'order_received',
      payload: { orderNumber: 'HAO-2026-200001', customerName: buyer.customerName },
      user: buyer,
    });
    expect(row).not.toBeNull();
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.to).toBe(buyer.email);
    expect(row.subject).toContain('HAO-2026-200001');
    expect(row.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('processOutbox with SMTP unset marks the row simulated, NOT sent', async () => {
    const row = await enqueueEmail({
      to: buyer.email,
      template: 'order_received',
      payload: { orderNumber: 'HAO-2026-200002' },
      user: buyer,
    });
    const summary = await processOutbox();
    expect(summary.simulated).toBe(1);
    const after = await EmailOutbox.findById(row._id);
    expect(after.status).toBe('simulated');

    // Simulated is terminal: a second pass does not touch it.
    const summary2 = await processOutbox();
    expect(summary2.processed).toBe(0);
  });

  it('processOutbox marks a real success as sent', async () => {
    mailMock.impl = async () => ({ success: true, messageId: 'msg-1' });
    const row = await enqueueEmail({
      to: buyer.email,
      template: 'order_received',
      payload: { orderNumber: 'HAO-2026-200003' },
      user: buyer,
    });
    await processOutbox();
    const after = await EmailOutbox.findById(row._id);
    expect(after.status).toBe('sent');
  });

  it('quote_ready and payment_received helpers enqueue their templates', async () => {
    const order = {
      orderNumber: 'HAO-2026-200004',
      customerDetails: { customerName: buyer.customerName, email: buyer.email },
      totalAmount: 75,
      currency: 'USD',
      user: buyer._id,
    };
    const quoteRow = await enqueueQuoteReady(order, buyer);
    expect(quoteRow.template).toBe('quote_ready');
    const payRow = await enqueuePaymentReceived(order, buyer, 75);
    expect(payRow.template).toBe('payment_received');
    expect(payRow.payload.amount).toBe(75);
    expect(await EmailOutbox.countDocuments({})).toBe(2);
  });
});

// ── Outbox: retry / backoff / failure ──────────────────────────────────────
describe('FEAT-01 — outbox retry and backoff', () => {
  it('increments attempts, backs off, and fails after 5 attempts', async () => {
    mailMock.impl = async () => ({ success: false, error: 'SMTP boom' });
    const row = await enqueueEmail({
      to: buyer.email,
      template: 'order_received',
      payload: { orderNumber: 'HAO-2026-200005' },
      user: buyer,
    });

    for (let i = 1; i <= MAX_OUTBOX_ATTEMPTS; i += 1) {
      // Make the row due again, as the clock would eventually do.
      await EmailOutbox.updateOne({ _id: row._id }, { nextAttemptAt: new Date(Date.now() - 1000) });
      await processOutbox();
      const current = await EmailOutbox.findById(row._id);
      expect(current.attempts).toBe(i);
      expect(current.lastError).toBe('SMTP boom');
      if (i < MAX_OUTBOX_ATTEMPTS) {
        expect(current.status).toBe('pending');
        expect(current.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      } else {
        expect(current.status).toBe('failed');
      }
    }

    // Failed rows are terminal: no further processing.
    const summary = await processOutbox();
    expect(summary.processed).toBe(0);
  });
});

// ── Outbox: recipient preference ───────────────────────────────────────────
describe('FEAT-01 — email preference opt-out', () => {
  it('a user with notifications.email=false gets no outbox row', async () => {
    await User.updateOne({ _id: buyer._id }, { $set: { 'notifications.email': false } });
    const optedOut = await User.findById(buyer._id);
    expect(optedOut.notifications.email).toBe(false);

    const row = await enqueueEmail({
      to: optedOut.email,
      template: 'order_received',
      payload: { orderNumber: 'HAO-2026-200006' },
      user: optedOut,
    });
    expect(row).toBeNull();
    expect(await EmailOutbox.countDocuments({})).toBe(0);
  });

  it('the preference is honoured when only the user id is supplied', async () => {
    await User.updateOne({ _id: buyer._id }, { $set: { 'notifications.email': false } });
    const row = await enqueueEmail({
      to: buyer.email,
      template: 'order_received',
      payload: { orderNumber: 'HAO-2026-200007' },
      user: buyer._id,
    });
    expect(row).toBeNull();
  });

  it('with no user supplied, enqueue always happens', async () => {
    const row = await enqueueEmail({
      to: 'someone@example.com',
      template: 'order_received',
      payload: { orderNumber: 'HAO-2026-200008' },
    });
    expect(row).not.toBeNull();
    expect(row.status).toBe('pending');
  });
});

// ── Notifications API ──────────────────────────────────────────────────────
describe('FEAT-01 — notifications API', () => {
  beforeEach(async () => {
    await notify({ user: buyer._id, type: 'order_created', title: 'First', body: 'b1', link: '/my-orders' });
    await notify({ user: buyer._id, type: 'order_status_changed', title: 'Second', body: 'b2' });
    await notify({ user: other._id, type: 'order_created', title: 'Not yours', body: 'b3' });
  });

  it('lists only the caller\'s notifications, newest first', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body.data.map((n) => n.title)).toEqual(['Second', 'First']);
    expect(res.body.data.every((n) => n.user === buyer._id.toString())).toBe(true);
  });

  it('supports the ?unread=true filter', async () => {
    const one = await Notification.findOne({ user: buyer._id, title: 'First' });
    await request(app)
      .patch(`/api/notifications/${one._id}/read`)
      .set('Authorization', `Bearer ${buyerToken}`);
    const res = await request(app)
      .get('/api/notifications?unread=true')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].title).toBe('Second');
  });

  it('unread-count is correct', async () => {
    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, count: 2 });
  });

  it('PATCH /:id/read marks it read and drops the unread count', async () => {
    const target = await Notification.findOne({ user: buyer._id, title: 'First' });
    const res = await request(app)
      .patch(`/api/notifications/${target._id}/read`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.read).toBe(true);
    const count = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(count.body.count).toBe(1);
  });

  it('PATCH on another user\'s notification returns 404', async () => {
    const theirs = await Notification.findOne({ user: other._id });
    const res = await request(app)
      .patch(`/api/notifications/${theirs._id}/read`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(404);
    const after = await Notification.findById(theirs._id);
    expect(after.read).toBe(false);
  });

  it('POST /read-all marks all the caller\'s unread as read', async () => {
    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, count: 2 });
    expect(await Notification.countDocuments({ user: buyer._id, read: false })).toBe(0);
    // The other user's notification is untouched.
    expect(await Notification.countDocuments({ user: other._id, read: false })).toBe(1);
  });

  it('rejects unauthenticated requests with 401', async () => {
    for (const call of [
      () => request(app).get('/api/notifications'),
      () => request(app).get('/api/notifications/unread-count'),
      () => request(app).post('/api/notifications/read-all'),
    ]) {
      const res = await call();
      expect(res.status).toBe(401);
    }
    const any = await Notification.findOne({ user: buyer._id });
    const patch = await request(app).patch(`/api/notifications/${any._id}/read`);
    expect(patch.status).toBe(401);
  });
});

// ── Order wiring ───────────────────────────────────────────────────────────
describe('FEAT-01 — order wiring', () => {
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

  it('creating an order produces an outbox row + a notification for the buyer', async () => {
    const res = await createOrderViaApi(buyerToken);
    expect(res.status).toBe(201);

    const rows = await EmailOutbox.find({ template: 'order_received' });
    expect(rows).toHaveLength(1);
    expect(rows[0].to).toBe(buyer.email);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].payload.orderNumber).toBe(res.body.order.orderNumber);

    const notifs = await Notification.find({ user: buyer._id });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe('order_created');
  });

  it('creating a Draft produces no outbox row and no notification', async () => {
    const res = await createOrderViaApi(buyerToken, { status: 'Draft' });
    expect(res.status).toBe(201);
    expect(await EmailOutbox.countDocuments({})).toBe(0);
    expect(await Notification.countDocuments({})).toBe(0);
  });

  it('a status transition produces a status-changed outbox row + notification', async () => {
    const created = await createOrderViaApi(buyerToken, { status: 'Draft' });
    const orderId = created.body.order._id;

    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ status: 'Submitted' });
    expect(res.status).toBe(200);

    const rows = await EmailOutbox.find({ template: 'order_status_changed' });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.newStatus).toBe('Submitted');

    const notifs = await Notification.find({ user: buyer._id, type: 'order_status_changed' });
    expect(notifs).toHaveLength(1);
  });

  it('shipping an order also enqueues order_shipped with carrier + tracking', async () => {
    const created = await createOrderViaApi(buyerToken);
    const orderId = created.body.order._id;

    const transition = (status, extra = {}) =>
      request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status, ...extra });

    expect((await transition('Confirmed')).status).toBe(200);
    expect((await transition('In Production')).status).toBe(200);
    expect((await transition('Quality Check')).status).toBe(200);
    const shipped = await transition('Shipped', {
      trackingNumber: 'TRK-999',
      carrierName: 'Maersk',
    });
    expect(shipped.status).toBe(200);

    const shippedRows = await EmailOutbox.find({ template: 'order_shipped' });
    expect(shippedRows).toHaveLength(1);
    expect(shippedRows[0].payload.trackingNumber).toBe('TRK-999');
    expect(shippedRows[0].payload.carrier).toBe('Maersk');
  });
});
