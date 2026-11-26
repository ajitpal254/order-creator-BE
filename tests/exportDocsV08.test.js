/**
 * exportDocsV08.test.js
 * FEAT-08 (v0.8): shipping + export documents.
 * - Each of the 4 standalone generators produces a real PDF buffer and
 *   the generate endpoint vaults it (metadata + downloadable PDF).
 * - Vault versioning increments on regenerate and on upload.
 * - Ownership: another buyer gets 404 on list/generate/download/upload.
 * - Upload + download round-trip through local storage returns the
 *   same bytes and content type.
 * - Delete is staff-only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';
import fsp from 'fs/promises';
import path from 'path';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { OrderDocument } from '../src/models/OrderDocument.js';
import { generateAccessToken } from '../src/utils/token.js';
import {
  generatePackingList,
  generateExportCommercialInvoice,
  generateCertificateOfOrigin,
  generateShippingLabels,
} from '../src/utils/exportDocs/index.js';

const UPLOAD_PDF = Buffer.from('%PDF-1.4\n% uploaded export document fixture\n%%EOF\n');

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

let mongod;
let app;
let owner;
let otherBuyer;
let staff;
let ownerToken;
let otherToken;
let staffToken;
let order;
const storedKeys = [];

const makeUser = async (suffix, role) =>
  User.create({
    customerName: `Doc ${suffix}`,
    businessName: `Doc ${suffix} Corp`,
    country: 'Canada',
    phoneNumber: '+1-555-0100',
    address: '123 Test St',
    username: `doc_${suffix}_${Date.now()}`,
    email: `doc_${suffix}_${Date.now()}@example.com`,
    password: 'supersecretpassword1',
    role,
  });

const makeOrder = async (userId, orderNumber) =>
  Order.create({
    orderNumber,
    user: userId,
    customerDetails: {
      customerName: 'Consignee Person',
      businessName: 'Consignee GmbH',
      country: 'Germany',
      phoneNumber: '+49-555-0100',
      address: '1 Consignee Way, Hamburg',
      email: 'consignee@example.com',
    },
    items: [
      {
        productName: 'Claw Hammer',
        sku: 'HAM-001',
        size: '16oz',
        quantity: 40,
        unitPrice: 10,
        totalPrice: 400,
        packaging: 'Master Carton',
        customMarking: 'CG-LOGO',
        snapshot: { weightKg: 0.5, pcsPerCarton: 20 },
      },
      {
        productName: 'Wrench Set',
        sku: 'WRN-002',
        quantity: 10,
        unitPrice: 25,
        totalPrice: 250,
        // no snapshot: weight/carton fields must be omitted gracefully
      },
    ],
    totalQuantity: 50,
    subtotalAmount: 650,
    discountAmount: 0,
    totalAmount: 650,
    currency: 'USD',
    incoterm: 'FOB',
    estimatedWeightKg: 20,
    estimatedCartons: 2,
    shippingMarks: 'CG HAMBURG C/NO 1-2',
    status: 'Confirmed',
  });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Order.init(), OrderDocument.init()]);
  app = buildTestApp();

  owner = await makeUser('owner', 'user');
  otherBuyer = await makeUser('other', 'user');
  staff = await makeUser('staff', 'shipping_officer');
  ownerToken = generateAccessToken(owner);
  otherToken = generateAccessToken(otherBuyer);
  staffToken = generateAccessToken(staff);
  order = await makeOrder(owner._id, 'HAO-2026-200001');
}, 60000);

afterAll(async () => {
  for (const key of storedKeys) {
    await fsp.rm(path.join(process.cwd(), 'uploads', key), { force: true });
  }
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

const trackKeys = async () => {
  const docs = await OrderDocument.find({ order: order._id }).select('storageKey').lean();
  for (const d of docs) if (!storedKeys.includes(d.storageKey)) storedKeys.push(d.storageKey);
};

// ── Generator unit tests ───────────────────────────────────────────────────
describe('FEAT-08 — standalone generators produce PDFs', () => {
  const generators = {
    packing_list: generatePackingList,
    export_commercial_invoice: generateExportCommercialInvoice,
    certificate_of_origin: generateCertificateOfOrigin,
    shipping_labels: generateShippingLabels,
  };

  for (const [type, gen] of Object.entries(generators)) {
    it(`${type} returns a %PDF- buffer`, async () => {
      const buf = await gen(order);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(200);
      expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });
  }

  it('certificate of origin honours the env exporter profile + Canada default', async () => {
    const withEnv = await generateCertificateOfOrigin(order, {
      EXPORTER_NAME: 'Acme Exports Inc',
      EXPORTER_COUNTRY: 'India',
    });
    expect(withEnv.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const defaulted = await generateCertificateOfOrigin(order, {});
    expect(defaulted.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

// ── Generate endpoint ──────────────────────────────────────────────────────
describe('FEAT-08 — POST /api/orders/:id/documents/generate', () => {
  it.each([
    'packing_list',
    'export_commercial_invoice',
    'certificate_of_origin',
    'shipping_labels',
  ])('owner generates %s (v1) and can download the PDF', async (type) => {
    const res = await request(app)
      .post(`/api/orders/${order._id}/documents/generate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe(type);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.generatedFrom).toBe('system');
    expect(res.body.data.contentType).toBe('application/pdf');
    if (type === 'export_commercial_invoice') {
      expect(res.body.data.title).toMatch(/Export Commercial Invoice/);
    }
    await trackKeys();

    const dl = await request(app)
      .get(`/api/orders/${order._id}/documents/${res.body.data._id}/download`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toMatch(/application\/pdf/);
    expect(dl.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('staff can generate for any order', async () => {
    const res = await request(app)
      .post(`/api/orders/${order._id}/documents/generate`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ type: 'shipping_labels' });
    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(2); // shipping_labels already at v1
    await trackKeys();
  });

  it('regenerating increments the version', async () => {
    const res = await request(app)
      .post(`/api/orders/${order._id}/documents/generate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'packing_list' });
    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(2);
    await trackKeys();
  });

  it('rejects a non-generatable type', async () => {
    const res = await request(app)
      .post(`/api/orders/${order._id}/documents/generate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ type: 'custom' });
    expect(res.status).toBe(400);
  });

  it('another buyer gets 404 on generate', async () => {
    const res = await request(app)
      .post(`/api/orders/${order._id}/documents/generate`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ type: 'packing_list' });
    expect(res.status).toBe(404);
  });
});

// ── List / ownership ───────────────────────────────────────────────────────
describe('FEAT-08 — GET /api/orders/:id/documents', () => {
  it('lists the vault newest first for the owner', async () => {
    const res = await request(app)
      .get(`/api/orders/${order._id}/documents`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(5);
    const times = res.body.data.map((d) => new Date(d.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('another buyer gets 404 on list', async () => {
    const res = await request(app)
      .get(`/api/orders/${order._id}/documents`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it('another buyer gets 404 on download', async () => {
    const doc = await OrderDocument.findOne({ order: order._id, type: 'packing_list' });
    const res = await request(app)
      .get(`/api/orders/${order._id}/documents/${doc._id}/download`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
  });

  it('unknown order gets 404', async () => {
    const res = await request(app)
      .get(`/api/orders/${new mongoose.Types.ObjectId()}/documents`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Upload / download round-trip ───────────────────────────────────────────
describe('FEAT-08 — POST /api/orders/:id/documents/upload', () => {
  it('uploads a PDF as custom v1 and downloads the identical bytes back', async () => {
    const res = await request(app)
      .post(`/api/orders/${order._id}/documents/upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', UPLOAD_PDF, { filename: 'inspection.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('custom');
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.generatedFrom).toBe('upload');
    expect(res.body.data.contentType).toBe('application/pdf');
    await trackKeys();

    const dl = await request(app)
      .get(`/api/orders/${order._id}/documents/${res.body.data._id}/download`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.compare(dl.body, UPLOAD_PDF)).toBe(0);
  });

  it('upload of an existing type takes the next version for that type', async () => {
    const res = await request(app)
      .post(`/api/orders/${order._id}/documents/upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .field('type', 'packing_list')
      .attach('file', UPLOAD_PDF, { filename: 'pl-scan.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('packing_list');
    expect(res.body.data.version).toBe(3); // two generated versions already exist
    await trackKeys();
  });

  it('rejects a fake PDF (text bytes)', async () => {
    const res = await request(app)
      .post(`/api/orders/${order._id}/documents/upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', Buffer.from('not a pdf at all'), {
        filename: 'fake.pdf',
        contentType: 'application/pdf',
      });
    expect(res.body.success).toBe(false);
  });

  it('another buyer gets 404 on upload', async () => {
    const res = await request(app)
      .post(`/api/orders/${order._id}/documents/upload`)
      .set('Authorization', `Bearer ${otherToken}`)
      .attach('file', UPLOAD_PDF, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(404);
  });
});

// ── Delete (staff only) ────────────────────────────────────────────────────
describe('FEAT-08 — DELETE /api/orders/:id/documents/:docId', () => {
  it('owner (non-staff) cannot delete', async () => {
    const doc = await OrderDocument.findOne({ order: order._id, type: 'custom' });
    const res = await request(app)
      .delete(`/api/orders/${order._id}/documents/${doc._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
    expect(await OrderDocument.findById(doc._id)).not.toBeNull();
  });

  it('staff deletes the row and the stored file; download then 404s', async () => {
    const doc = await OrderDocument.findOne({ order: order._id, type: 'custom' });
    const filePath = path.join(process.cwd(), 'uploads', doc.storageKey);
    const res = await request(app)
      .delete(`/api/orders/${order._id}/documents/${doc._id}`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
    expect(await OrderDocument.findById(doc._id)).toBeNull();
    await expect(fsp.access(filePath)).rejects.toThrow();

    const dl = await request(app)
      .get(`/api/orders/${order._id}/documents/${doc._id}/download`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(dl.status).toBe(404);
  });
});
