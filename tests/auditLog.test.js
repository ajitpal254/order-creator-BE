/**
 * auditLog.test.js
 * SEC-10 (v0.3): audit log.
 * - logAudit rows are written on product create/update/delete, user
 *   toggle-status, user role change, and order status transitions,
 *   with actor / ip / requestId and before/after snapshots.
 * - GET /api/admin/audit-logs is admin + super_admin only, paginated
 *   with the established envelope, filterable, newest first.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import productRoutes from '../src/routes/productRoutes.js';
import userRoutes from '../src/routes/userRoutes.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import adminRoutes from '../src/routes/adminRoutes.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { Order } from '../src/models/Order.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { generateAccessToken } from '../src/utils/token.js';

function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  // Mirror server.js: request correlation id used by logAudit.
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    next();
  });
  app.use('/api/products', productRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/admin', adminRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Audit Buyer',
  businessName: 'Audit Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `audit_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `audit_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'supersecretpassword1',
  role: 'user',
  ...overrides,
});

let mongod;
let app;
let admin, adminToken;
let superAdmin, superAdminToken;
let staff, staffToken;
let buyer, buyerToken;
let target;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Product.init(), Order.init(), AuditLog.init()]);
  app = buildTestApp();

  admin = await User.create(makeUser({ role: 'admin' }));
  adminToken = generateAccessToken(admin);
  superAdmin = await User.create(makeUser({ role: 'super_admin' }));
  superAdminToken = generateAccessToken(superAdmin);
  staff = await User.create(makeUser({ role: 'sales_manager' }));
  staffToken = generateAccessToken(staff);
  buyer = await User.create(makeUser({ role: 'user' }));
  buyerToken = generateAccessToken(buyer);
  target = await User.create(makeUser({ role: 'user' }));
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await AuditLog.deleteMany({});
  await Product.deleteMany({});
  await Order.deleteMany({});
  await User.updateOne({ _id: target._id }, { isActive: true, role: 'user' });
});

const createProduct = () =>
  request(app)
    .post('/api/products')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Audit Hammer', sku: `AUD-${Date.now()}`, category: 'Tools', basePrice: 25 });

// ── Wiring: rows are written on mutations ──────────────────────────────────
describe('SEC-10 — audit rows on mutations', () => {
  it('writes a row on product create with actor, requestId and after snapshot', async () => {
    const res = await createProduct();
    expect(res.status).toBe(201);

    const row = await AuditLog.findOne({ action: 'product.create' });
    expect(row).not.toBeNull();
    expect(row.actor.toString()).toBe(admin._id.toString());
    expect(row.entityType).toBe('Product');
    expect(row.entityId).toBe(res.body.data._id.toString());
    expect(row.before).toBeNull();
    expect(row.after.name).toBe('Audit Hammer');
    expect(typeof row.requestId).toBe('string');
    expect(row.requestId.length).toBeGreaterThan(0);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('writes rows on product update and delete', async () => {
    const created = await createProduct();
    const id = created.body.data._id;

    const upd = await request(app)
      .put(`/api/products/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basePrice: 40 });
    expect(upd.status).toBe(200);

    const updRow = await AuditLog.findOne({ action: 'product.update' });
    expect(updRow).not.toBeNull();
    expect(updRow.before.basePrice).toBe(25);
    expect(updRow.after.basePrice).toBe(40);

    const del = await request(app)
      .delete(`/api/products/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const delRow = await AuditLog.findOne({ action: 'product.delete' });
    expect(delRow).not.toBeNull();
    expect(delRow.before.name).toBe('Audit Hammer');
    expect(delRow.after).toBeNull();
  });

  it('writes a row on user toggle-status with before/after isActive', async () => {
    const res = await request(app)
      .patch(`/api/users/${target._id}/toggle-status`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    const row = await AuditLog.findOne({ action: 'user.status.toggle' });
    expect(row).not.toBeNull();
    expect(row.entityType).toBe('User');
    expect(row.entityId).toBe(target._id.toString());
    expect(row.before).toEqual({ isActive: true });
    expect(row.after).toEqual({ isActive: false });
  });

  it('writes a row on user role change with before/after role', async () => {
    const res = await request(app)
      .patch(`/api/users/${target._id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'qc_inspector' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('qc_inspector');

    const row = await AuditLog.findOne({ action: 'user.role.change' });
    expect(row).not.toBeNull();
    expect(row.entityId).toBe(target._id.toString());
    expect(row.before).toEqual({ role: 'user' });
    expect(row.after).toEqual({ role: 'qc_inspector' });
  });

  it('rejects an invalid role on the role-change endpoint and writes no row', async () => {
    const res = await request(app)
      .patch(`/api/users/${target._id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'overlord' });
    expect(res.status).toBe(400);
    expect(await AuditLog.countDocuments({ action: 'user.role.change' })).toBe(0);
  });

  it('writes a row on order status change with before/after status', async () => {
    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        items: [{ productName: 'Test Hammer', sku: 'TST-HMR-001', quantity: 2, unitPrice: 10 }],
        status: 'Draft',
        orderType: 'Order',
      });
    expect(created.status).toBe(201);
    const orderId = created.body.order._id;

    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ status: 'Submitted' });
    expect(res.status).toBe(200);

    const row = await AuditLog.findOne({ action: 'order.status.change' });
    expect(row).not.toBeNull();
    expect(row.entityType).toBe('Order');
    expect(row.entityId).toBe(orderId.toString());
    expect(row.before).toEqual({ status: 'Draft' });
    expect(row.after).toEqual({ status: 'Submitted' });
    expect(row.actor.toString()).toBe(buyer._id.toString());
  });
});

// ── Read API: GET /api/admin/audit-logs ────────────────────────────────────
describe('SEC-10 — GET /api/admin/audit-logs', () => {
  beforeEach(async () => {
    await createProduct();
    await request(app)
      .patch(`/api/users/${target._id}/toggle-status`)
      .set('Authorization', `Bearer ${adminToken}`);
  });

  it('returns the paginated envelope for admin, newest first', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(100);
    expect(Array.isArray(res.body.data)).toBe(true);
    // Newest first: the toggle happened after the product create.
    expect(res.body.data[0].action).toBe('user.status.toggle');
    expect(res.body.data[1].action).toBe('product.create');
  });

  it('allows super_admin', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it('supports entityType / action / actor filters', async () => {
    const byType = await request(app)
      .get('/api/admin/audit-logs?entityType=Product')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byType.body.total).toBe(1);
    expect(byType.body.data[0].entityType).toBe('Product');

    const byAction = await request(app)
      .get('/api/admin/audit-logs?action=user.status.toggle')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byAction.body.total).toBe(1);

    const byActor = await request(app)
      .get(`/api/admin/audit-logs?actor=${admin._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byActor.body.total).toBe(2);

    const byEntity = await request(app)
      .get(`/api/admin/audit-logs?entityType=User&entityId=${target._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byEntity.body.total).toBe(1);
    expect(byEntity.body.data[0].entityId).toBe(target._id.toString());
  });

  it('rejects a regular user with 403', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('rejects non-admin staff (sales_manager) with 403', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/admin/audit-logs');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
