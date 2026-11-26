/**
 * companiesV09.test.js
 * FEAT-10 (v0.9) — buyer company accounts + spend approval:
 * - Company / CompanyMember models; POST /api/companies makes the
 *   creator an 'owner' member; GET /mine lists memberships with roles.
 * - Membership privacy: non-members get 404 everywhere; owner-only
 *   mutations 403 for non-owner members.
 * - Member management: invite by email (unknown email 404, invalid
 *   role 400, duplicate 409), role change, removal; the founding owner
 *   (company.createdBy) can be neither demoted nor removed.
 * - Order integration: companyId on createOrder (non-member → 404);
 *   total over the company spendLimit → approvalStatus 'pending'.
 * - Approval guard: staff confirm of a pending (or rejected) order →
 *   422 { code: 'APPROVAL_REQUIRED' }; approve by a company approver /
 *   owner who is NOT the order's creator unblocks confirmation;
 *   self-approval → 403; reject requires a reason.
 * - GET /api/companies/:id/orders: any member can view; non-member 404.
 * - Notifications: approvers/owners (not the creator) are notified on
 *   pending; the creator is notified on approve/reject.
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
import companyRoutes from '../src/routes/companyRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Company, CompanyMember } from '../src/models/Company.js';
import { Notification } from '../src/models/Notification.js';
import { EmailOutbox } from '../src/models/EmailOutbox.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { FxRate } from '../src/models/FxRate.js';
import { generateAccessToken } from '../src/utils/token.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/orders', orderRoutes);
  app.use('/api/companies', companyRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Company Buyer',
  businessName: 'Company Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `co_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `co_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'testpassword123',
  role: 'user',
  ...overrides,
});

let mongod;
let app;
let owner, ownerToken;
let purchaser, purchaserToken;
let approver, approverToken;
let finance, financeToken;
let outsider, outsiderToken;
let admin, adminToken;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const createCompany = async (token, body = {}) => {
  const res = await request(app)
    .post('/api/companies')
    .set(auth(token))
    .send({ name: 'Acme Exports', spendLimit: 100, creditTerms: 'Net 30', ...body });
  expect(res.status).toBe(201);
  return res.body.data;
};

const addMember = async (companyId, email, role, token = ownerToken) =>
  request(app)
    .post(`/api/companies/${companyId}/members`)
    .set(auth(token))
    .send({ email, role });

// Company owned by `owner` with purchaser + approver + finance members.
const setupCompany = async (spendLimit = 100) => {
  const company = await createCompany(ownerToken, { spendLimit });
  await addMember(company._id, purchaser.email, 'purchaser');
  await addMember(company._id, approver.email, 'approver');
  await addMember(company._id, finance.email, 'finance');
  return company;
};

const placeOrder = async (token, { companyId, unitPrice }) => {
  const res = await request(app)
    .post('/api/orders')
    .set(auth(token))
    .send({
      items: [{ productName: 'Test Hammer', sku: 'TST-HMR-001', quantity: 1, unitPrice }],
      ...(companyId ? { companyId } : {}),
    });
  expect(res.status).toBe(201);
  return res.body.order;
};

const confirmOrder = (orderId) =>
  request(app)
    .patch(`/api/orders/${orderId}/status`)
    .set(auth(adminToken))
    .send({ status: 'Confirmed' });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
  owner = await User.create(makeUser({ customerName: 'Olivia Owner' }));
  ownerToken = generateAccessToken(owner);
  purchaser = await User.create(makeUser({ customerName: 'Peter Purchaser' }));
  purchaserToken = generateAccessToken(purchaser);
  approver = await User.create(makeUser({ customerName: 'Anna Approver' }));
  approverToken = generateAccessToken(approver);
  finance = await User.create(makeUser({ customerName: 'Fred Finance' }));
  financeToken = generateAccessToken(finance);
  outsider = await User.create(makeUser({ customerName: 'Oscar Outsider' }));
  outsiderToken = generateAccessToken(outsider);
  admin = await User.create(makeUser({ role: 'admin' }));
  adminToken = generateAccessToken(admin);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await Order.deleteMany({});
  await Company.deleteMany({});
  await CompanyMember.deleteMany({});
  await Notification.deleteMany({});
  await EmailOutbox.deleteMany({});
  await AuditLog.deleteMany({});
  await FxRate.deleteMany({});
  // Fresh FX cache so the confirm-time rate lock never hits the network.
  await FxRate.create({
    base: 'EUR',
    rates: { EUR: 1, USD: 1, GBP: 1, AUD: 1 },
    fetchedAt: new Date(),
  });
});

// ── Company creation & reads ───────────────────────────────────────────────
describe('FEAT-10 — company create / read', () => {
  it('creates a company and makes the creator an owner member', async () => {
    const company = await createCompany(ownerToken);
    expect(company.name).toBe('Acme Exports');
    expect(company.spendLimit).toBe(100);
    expect(company.role).toBe('owner');

    const membership = await CompanyMember.findOne({ company: company._id, user: owner._id });
    expect(membership.role).toBe('owner');

    const audit = await AuditLog.findOne({ action: 'company.create', entityId: company._id.toString() });
    expect(audit).not.toBeNull();
  });

  it('GET /mine lists the caller companies with their role', async () => {
    const company = await setupCompany();
    const res = await request(app).get('/api/companies/mine').set(auth(approverToken));
    expect(res.status).toBe(200);
    const mine = res.body.data.find((c) => c._id === company._id);
    expect(mine).toBeTruthy();
    expect(mine.role).toBe('approver');
  });

  it('GET /:id returns the member list to a member', async () => {
    const company = await setupCompany();
    const res = await request(app).get(`/api/companies/${company._id}`).set(auth(financeToken));
    expect(res.status).toBe(200);
    expect(res.body.data.members).toHaveLength(4);
    const ownerRow = res.body.data.members.find((m) => m.role === 'owner');
    expect(ownerRow.email).toBe(owner.email);
    expect(ownerRow.name).toBe('Olivia Owner');
  });

  it('GET /:id returns 404 to a non-member', async () => {
    const company = await setupCompany();
    const res = await request(app).get(`/api/companies/${company._id}`).set(auth(outsiderToken));
    expect(res.status).toBe(404);
  });

  it('PATCH by a non-owner member is rejected (403); by an outsider 404; by the owner works', async () => {
    const company = await setupCompany();

    const byMember = await request(app)
      .patch(`/api/companies/${company._id}`)
      .set(auth(purchaserToken))
      .send({ name: 'Hijacked' });
    expect(byMember.status).toBe(403);

    const byOutsider = await request(app)
      .patch(`/api/companies/${company._id}`)
      .set(auth(outsiderToken))
      .send({ name: 'Hijacked' });
    expect(byOutsider.status).toBe(404);

    const byOwner = await request(app)
      .patch(`/api/companies/${company._id}`)
      .set(auth(ownerToken))
      .send({ name: 'Renamed Ltd', spendLimit: null, creditTerms: 'Net 60' });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.data.name).toBe('Renamed Ltd');
    expect(byOwner.body.data.spendLimit).toBeNull();
    expect(byOwner.body.data.creditTerms).toBe('Net 60');
  });
});

// ── Member management ──────────────────────────────────────────────────────
describe('FEAT-10 — member management', () => {
  it('invite with an unknown email → 404', async () => {
    const company = await createCompany(ownerToken);
    const res = await addMember(company._id, 'nobody-here@example.com', 'purchaser');
    expect(res.status).toBe(404);
  });

  it('invite with an invalid role → 400', async () => {
    const company = await createCompany(ownerToken);
    const res = await addMember(company._id, purchaser.email, 'boss');
    expect(res.status).toBe(400);
  });

  it('valid invite works and a duplicate invite → 409', async () => {
    const company = await createCompany(ownerToken);
    const first = await addMember(company._id, purchaser.email, 'purchaser');
    expect(first.status).toBe(201);
    expect(first.body.data.role).toBe('purchaser');

    const dup = await addMember(company._id, purchaser.email, 'finance');
    expect(dup.status).toBe(409);
  });

  it('role change works; the founding owner cannot be demoted', async () => {
    const company = await setupCompany();

    const changed = await request(app)
      .patch(`/api/companies/${company._id}/members/${approver._id}`)
      .set(auth(ownerToken))
      .send({ role: 'finance' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.role).toBe('finance');

    const demote = await request(app)
      .patch(`/api/companies/${company._id}/members/${owner._id}`)
      .set(auth(ownerToken))
      .send({ role: 'purchaser' });
    expect(demote.status).toBe(400);
  });

  it('remove member works; the founding owner cannot be removed', async () => {
    const company = await setupCompany();

    const removeOwner = await request(app)
      .delete(`/api/companies/${company._id}/members/${owner._id}`)
      .set(auth(ownerToken));
    expect(removeOwner.status).toBe(400);

    const removed = await request(app)
      .delete(`/api/companies/${company._id}/members/${finance._id}`)
      .set(auth(ownerToken));
    expect(removed.status).toBe(200);

    const after = await request(app).get(`/api/companies/${company._id}`).set(auth(financeToken));
    expect(after.status).toBe(404);
  });
});

// ── Order approval flow ────────────────────────────────────────────────────
describe('FEAT-10 — spend approval on orders', () => {
  it('order below the spend limit → approvalStatus none, confirm works as before', async () => {
    const company = await setupCompany(100);
    const order = await placeOrder(purchaserToken, { companyId: company._id, unitPrice: 50 });
    expect(order.company).toBe(company._id);
    expect(order.approvalStatus).toBe('none');

    const confirm = await confirmOrder(order._id);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('Confirmed');
  });

  it('order without a company keeps approvalStatus none', async () => {
    const order = await placeOrder(purchaserToken, { unitPrice: 5000 });
    expect(order.company).toBeNull();
    expect(order.approvalStatus).toBe('none');
  });

  it('order with a companyId the caller does not belong to → 404', async () => {
    const company = await setupCompany();
    const res = await request(app)
      .post('/api/orders')
      .set(auth(outsiderToken))
      .send({
        items: [{ productName: 'Test Hammer', sku: 'TST-HMR-001', quantity: 1, unitPrice: 10 }],
        companyId: company._id,
      });
    expect(res.status).toBe(404);
  });

  it('order above the spend limit → pending; staff confirm → 422 APPROVAL_REQUIRED', async () => {
    const company = await setupCompany(100);
    const order = await placeOrder(purchaserToken, { companyId: company._id, unitPrice: 250 });
    expect(order.approvalStatus).toBe('pending');

    // Approvers/owners (not the creator) were notified.
    const approverNotifs = await Notification.find({ user: approver._id, type: 'order_approval_requested' });
    expect(approverNotifs).toHaveLength(1);
    const ownerNotifs = await Notification.find({ user: owner._id, type: 'order_approval_requested' });
    expect(ownerNotifs).toHaveLength(1);
    const creatorNotifs = await Notification.find({ user: purchaser._id, type: 'order_approval_requested' });
    expect(creatorNotifs).toHaveLength(0);

    const confirm = await confirmOrder(order._id);
    expect(confirm.status).toBe(422);
    expect(confirm.body.code).toBe('APPROVAL_REQUIRED');
  });

  it('approver (not the creator) approves → confirm then succeeds; creator is notified', async () => {
    const company = await setupCompany(100);
    const order = await placeOrder(purchaserToken, { companyId: company._id, unitPrice: 250 });

    const approve = await request(app).post(`/api/orders/${order._id}/approve`).set(auth(approverToken));
    expect(approve.status).toBe(200);
    expect(approve.body.data.approvalStatus).toBe('approved');
    expect(approve.body.data.approvalBy).toBe(approver._id.toString());
    expect(approve.body.data.approvalAt).toBeTruthy();

    const decided = await Notification.find({ user: purchaser._id, type: 'order_approval_approved' });
    expect(decided).toHaveLength(1);

    const audit = await AuditLog.findOne({ action: 'order.approval.approve', entityId: order._id.toString() });
    expect(audit).not.toBeNull();

    const confirm = await confirmOrder(order._id);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('Confirmed');
  });

  it('the order creator cannot approve their own order (403), even as company owner', async () => {
    const company = await setupCompany(100);
    // The owner places the order — owners can approve, but not their own.
    const order = await placeOrder(ownerToken, { companyId: company._id, unitPrice: 250 });
    expect(order.approvalStatus).toBe('pending');

    const selfApprove = await request(app).post(`/api/orders/${order._id}/approve`).set(auth(ownerToken));
    expect(selfApprove.status).toBe(403);

    // A purchaser member also cannot approve (wrong role → 403).
    const order2 = await placeOrder(purchaserToken, { companyId: company._id, unitPrice: 250 });
    const byPurchaser = await request(app).post(`/api/orders/${order2._id}/approve`).set(auth(purchaserToken));
    expect(byPurchaser.status).toBe(403);

    // A non-member gets 404 (no leak).
    const byOutsider = await request(app).post(`/api/orders/${order2._id}/approve`).set(auth(outsiderToken));
    expect(byOutsider.status).toBe(404);
  });

  it('approve on an order that is not pending → 400', async () => {
    const company = await setupCompany(100);
    const order = await placeOrder(purchaserToken, { companyId: company._id, unitPrice: 50 });
    const res = await request(app).post(`/api/orders/${order._id}/approve`).set(auth(approverToken));
    expect(res.status).toBe(400);
  });

  it('reject-approval requires a reason; a rejected order stays unconfirmable (422)', async () => {
    const company = await setupCompany(100);
    const order = await placeOrder(purchaserToken, { companyId: company._id, unitPrice: 250 });

    const noReason = await request(app)
      .post(`/api/orders/${order._id}/reject-approval`)
      .set(auth(approverToken))
      .send({});
    expect(noReason.status).toBe(400);

    const reject = await request(app)
      .post(`/api/orders/${order._id}/reject-approval`)
      .set(auth(approverToken))
      .send({ reason: 'Over quarterly budget' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.approvalStatus).toBe('rejected');
    expect(reject.body.data.approvalReason).toBe('Over quarterly budget');

    const decided = await Notification.find({ user: purchaser._id, type: 'order_approval_rejected' });
    expect(decided).toHaveLength(1);

    const confirm = await confirmOrder(order._id);
    expect(confirm.status).toBe(422);
    expect(confirm.body.code).toBe('APPROVAL_REQUIRED');
  });
});

// ── Company orders list ────────────────────────────────────────────────────
describe('FEAT-10 — company orders list', () => {
  it('a member who did not create the order can view company orders (paginated envelope)', async () => {
    const company = await setupCompany(100);
    const order = await placeOrder(purchaserToken, { companyId: company._id, unitPrice: 50 });
    await placeOrder(purchaserToken, { unitPrice: 10 }); // personal order — must not appear

    const res = await request(app).get(`/api/companies/${company._id}/orders`).set(auth(financeToken));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(1);
    expect(res.body.count).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.data[0]._id).toBe(order._id);
  });

  it('a non-member gets 404 on the company orders list', async () => {
    const company = await setupCompany();
    const res = await request(app).get(`/api/companies/${company._id}/orders`).set(auth(outsiderToken));
    expect(res.status).toBe(404);
  });
});
