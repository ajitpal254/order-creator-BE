/**
 * invoiceIntegration.test.js
 * Integration tests for invoice routes using supertest + mongodb-memory-server.
 * 
 * Covers Phase 5 requirements:
 * - Invoice total/tax calculation (end-to-end via API)
 * - Ownership/authorization checks on invoice and order routes
 * - PDF generation not throwing on edge-case input
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// We need to import the app without starting the server.
// Server bootstraps DB connection internally, so we replicate the middleware setup.
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import authRoutes from '../src/routes/authRoutes.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import invoiceRoutes from '../src/routes/invoiceRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Invoice } from '../src/models/Invoice.js';
import { generateAccessToken } from '../src/utils/token.js';

// ── Test App Setup ────────────────────────────────────────────────────────────
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/auth', authRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeUser = (overrides = {}) => ({
  customerName: 'Test Buyer',
  businessName: 'Test Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `testuser_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'TestPass123!',
  role: 'user',
  ...overrides,
});

const makeAdminUser = (overrides = {}) => makeUser({
  username: `admin_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `admin_${Date.now()}_${Math.random().toString(36).slice(2)}@haoverseas.com`,
  role: 'admin',
  ...overrides,
});

// ── Suite Setup ───────────────────────────────────────────────────────────────
let mongod;
let app;
let buyerUser, otherUser, adminUser;
let buyerToken, otherToken, adminToken;
let testOrder;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();

  // Create test users directly in DB (bypass route to avoid rate limiter)
  buyerUser = await User.create(makeUser());
  otherUser = await User.create(makeUser());
  adminUser = await User.create(makeAdminUser());

  buyerToken = generateAccessToken(buyerUser);
  otherToken = generateAccessToken(otherUser);
  adminToken = generateAccessToken(adminUser);

  // Create a test order owned by buyerUser
  testOrder = await Order.create({
    orderNumber: 'HAO-TEST-100001',
    orderType: 'Order',
    user: buyerUser._id,
    customerDetails: {
      customerName: buyerUser.customerName,
      businessName: buyerUser.businessName,
      country: 'Canada',
      phoneNumber: buyerUser.phoneNumber,
      address: buyerUser.address,
      email: buyerUser.email,
    },
    items: [{
      productName: 'Test Hammer',
      sku: 'TST-HMR-001',
      quantity: 10,
      unitPrice: 5.0,
      totalPrice: 50.0,
    }],
    totalQuantity: 10,
    subtotalAmount: 50.0,
    totalAmount: 50.0,
    currency: 'USD',
    incoterm: 'FOB',
    status: 'Confirmed',
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clean invoices between tests to avoid state bleed
  await Invoice.deleteMany({});
  // Reset order invoice status
  await Order.findByIdAndUpdate(testOrder._id, {
    invoice: { invoiceId: null, pdfUrl: null, status: null, isPending: false, lastAttemptAt: null, error: null }
  });
});

// ── Tests: Invoice Creation ───────────────────────────────────────────────────
describe('POST /api/invoices — create invoice', () => {
  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app).post('/api/invoices').send({});
    expect(res.status).toBe(401);
  });

  it('creates a draft invoice from an owned order', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        orderId: testOrder._id.toString(),
        docType: 'commercial_invoice',
        currency: 'USD',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.invoice.status).toBe('draft');
    expect(res.body.invoice.order).toBe(testOrder._id.toString());
    expect(res.body.invoice.user).toBe(buyerUser._id.toString());
  });

  it('recalculates totals server-side (ignores client-submitted totals)', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        docType: 'commercial_invoice',
        currency: 'USD',
        customerDetails: { customerName: 'Acme Corp' },
        items: [{ quantity: 10, unitPrice: 5.0, discountPercent: 10 }],
        // Attacker tries to submit a fake grand total
        grandTotal: 9999999,
        subtotal: 9999999,
      });

    expect(res.status).toBe(201);
    // 10 * 5 * 0.9 = 45 — server must recalculate, not trust client
    expect(res.body.invoice.subtotal).toBe(45);
    expect(res.body.invoice.grandTotal).toBe(45);
  });

  it('returns 403 when trying to invoice another user\'s order (IDOR check)', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${otherToken}`) // different user
      .send({
        orderId: testOrder._id.toString(), // owned by buyerUser
        docType: 'commercial_invoice',
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not authorized/i);
  });

  it('admin can invoice any user\'s order', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        orderId: testOrder._id.toString(),
        docType: 'commercial_invoice',
      });

    expect(res.status).toBe(201);
  });

  it('validates docType enum and rejects unknown values', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        docType: 'fake_invoice_type',
        customerDetails: { customerName: 'Test' },
        items: [{ quantity: 1, unitPrice: 10 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });
});

// ── Tests: Invoice List (scoping) ─────────────────────────────────────────────
describe('GET /api/invoices — list invoices', () => {
  beforeEach(async () => {
    // Create invoice owned by buyerUser
    await Invoice.create({
      invoiceNumber: 'INV-TEST-BUYER-001',
      docType: 'commercial_invoice',
      status: 'draft',
      user: buyerUser._id,
      customerDetails: { customerName: 'Acme' },
      items: [],
      currency: 'USD',
      grandTotal: 100,
      balanceDue: 100,
    });
    // Create invoice owned by otherUser
    await Invoice.create({
      invoiceNumber: 'INV-TEST-OTHER-001',
      docType: 'commercial_invoice',
      status: 'sent',
      user: otherUser._id,
      customerDetails: { customerName: 'Beta Corp' },
      items: [],
      currency: 'USD',
      grandTotal: 200,
      balanceDue: 200,
    });
  });

  it('returns only own invoices for a regular buyer', async () => {
    const res = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].invoiceNumber).toBe('INV-TEST-BUYER-001');
  });

  it('returns all invoices for an admin', async () => {
    const res = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('returns 401 without auth', async () => {
    expect((await request(app).get('/api/invoices')).status).toBe(401);
  });
});

// ── Tests: Invoice Get By ID (ownership) ─────────────────────────────────────
describe('GET /api/invoices/:id — get single invoice', () => {
  let buyerInvoice;

  beforeEach(async () => {
    buyerInvoice = await Invoice.create({
      invoiceNumber: 'INV-OWNER-001',
      docType: 'commercial_invoice',
      status: 'draft',
      user: buyerUser._id,
      customerDetails: { customerName: 'Acme' },
      items: [],
      currency: 'USD',
      grandTotal: 50,
      balanceDue: 50,
    });
  });

  it('allows owner to view their own invoice', async () => {
    const res = await request(app)
      .get(`/api/invoices/${buyerInvoice._id}`)
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invoice.invoiceNumber).toBe('INV-OWNER-001');
  });

  it('blocks other users from viewing (IDOR protection)', async () => {
    const res = await request(app)
      .get(`/api/invoices/${buyerInvoice._id}`)
      .set('Authorization', `Bearer ${otherToken}`); // different user

    expect(res.status).toBe(403);
  });

  it('allows admin to view any invoice', async () => {
    const res = await request(app)
      .get(`/api/invoices/${buyerInvoice._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent invoice ID', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/invoices/${fakeId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

// ── Tests: Payment Recording ──────────────────────────────────────────────────
describe('POST /api/invoices/:id/payments — record payment', () => {
  let sentInvoice;

  beforeEach(async () => {
    sentInvoice = await Invoice.create({
      invoiceNumber: 'INV-PAY-001',
      docType: 'commercial_invoice',
      status: 'sent',
      user: buyerUser._id,
      customerDetails: { customerName: 'Acme' },
      items: [],
      currency: 'USD',
      grandTotal: 1000,
      amountPaid: 0,
      balanceDue: 1000,
    });
  });

  it('blocks regular buyer from recording payments', async () => {
    const res = await request(app)
      .post(`/api/invoices/${sentInvoice._id}/payments`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ amount: 500 });

    expect(res.status).toBe(403);
  });

  it('allows admin to record a payment', async () => {
    const res = await request(app)
      .post(`/api/invoices/${sentInvoice._id}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 500, paymentMethod: 'Wire Transfer', referenceNumber: 'TXN-001' });

    expect(res.status).toBe(200);
    expect(res.body.invoice.amountPaid).toBe(500);
    expect(res.body.invoice.balanceDue).toBe(500);
    expect(res.body.invoice.status).toBe('partial');
  });

  it('marks invoice as paid when full amount is recorded', async () => {
    const res = await request(app)
      .post(`/api/invoices/${sentInvoice._id}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('paid');
    expect(res.body.invoice.balanceDue).toBe(0);
  });

  it('rejects negative payment amount', async () => {
    const res = await request(app)
      .post(`/api/invoices/${sentInvoice._id}/payments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: -500 });

    expect(res.status).toBe(400);
  });
});

// ── Tests: Void Invoice ───────────────────────────────────────────────────────
describe('POST /api/invoices/:id/void', () => {
  let sentInvoice;

  beforeEach(async () => {
    sentInvoice = await Invoice.create({
      invoiceNumber: 'INV-VOID-001',
      docType: 'commercial_invoice',
      status: 'sent',
      user: buyerUser._id,
      customerDetails: { customerName: 'Acme' },
      items: [],
      currency: 'USD',
      grandTotal: 500,
      balanceDue: 500,
    });
  });

  it('blocks regular buyer from voiding', async () => {
    const res = await request(app)
      .post(`/api/invoices/${sentInvoice._id}/void`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Duplicate entry' });

    expect(res.status).toBe(403);
  });

  it('allows admin to void with a reason', async () => {
    const res = await request(app)
      .post(`/api/invoices/${sentInvoice._id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Issued in error' });

    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('void');
    expect(res.body.invoice.voidReason).toBe('Issued in error');
  });

  it('rejects void without reason', async () => {
    const res = await request(app)
      .post(`/api/invoices/${sentInvoice._id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'no' }); // < 3 chars

    expect(res.status).toBe(400);
  });

  it('blocks voiding an already-voided invoice', async () => {
    // Create a dedicated invoice for this test to avoid state bleed from sibling tests
    const freshInvoice = await Invoice.create({
      invoiceNumber: `INV-VOID-DOUBLE-${Date.now()}`,
      docType: 'commercial_invoice',
      status: 'sent',
      user: buyerUser._id,
      customerDetails: { customerName: 'Acme' },
      items: [],
      currency: 'USD',
      grandTotal: 500,
      balanceDue: 500,
    });

    // First void — should succeed
    await request(app)
      .post(`/api/invoices/${freshInvoice._id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'First void reason' });

    // Second void attempt on the same invoice — should fail
    const res = await request(app)
      .post(`/api/invoices/${freshInvoice._id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Second void attempt' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/void/i);
  });
});

// ── Tests: PDF Download ───────────────────────────────────────────────────────
describe('GET /api/invoices/:id/pdf', () => {
  let buyerInvoice;

  beforeEach(async () => {
    buyerInvoice = await Invoice.create({
      invoiceNumber: 'INV-PDF-001',
      docType: 'commercial_invoice',
      status: 'draft',
      user: buyerUser._id,
      customerDetails: {
        customerName: 'PDF Test Corp',
        businessName: 'PDF Test Corp Ltd',
        country: 'United States',
        phoneNumber: '+1-555-0100',
        address: '123 PDF St',
        email: 'pdf@test.com',
      },
      items: [{
        productName: 'Test Hammer',
        sku: 'TST-001',
        hsnCode: '8205.59',
        quantity: 10,
        unit: 'PCS',
        unitPrice: 5.0,
        discountPercent: 0,
        lineSubtotal: 50,
        lineDiscount: 0,
        lineNet: 50,
        lineTax: 0,
        lineTotal: 50,
      }],
      currency: 'USD',
      subtotal: 50,
      taxableAmount: 50,
      taxAmount: 0,
      grandTotal: 50,
      amountPaid: 0,
      balanceDue: 50,
      totalInWords: 'TOTAL US$: FIFTY DOLLARS ONLY',
    });
  });

  it('allows owner to download invoice PDF', async () => {
    const res = await request(app)
      .get(`/api/invoices/${buyerInvoice._id}/pdf`)
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    // PDF magic bytes
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  it('blocks other user from downloading PDF (IDOR)', async () => {
    const res = await request(app)
      .get(`/api/invoices/${buyerInvoice._id}/pdf`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it('allows admin to download any PDF', async () => {
    const res = await request(app)
      .get(`/api/invoices/${buyerInvoice._id}/pdf`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });
});
