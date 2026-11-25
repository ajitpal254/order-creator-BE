/**
 * uploadStorage.test.js
 * SEC-09 (v0.3): upload hardening + storage abstraction.
 * - sniffImageType decides from magic bytes (JPEG/PNG/WebP), never
 *   from the client-supplied name or Content-Type.
 * - The product upload endpoint rejects fake images (text bytes with
 *   an image mimetype) and declared/actual mismatches (PNG bytes
 *   claiming JPEG); real images are stored under the SNIFFED extension.
 * - The local storage driver round-trips put/get/delete in a temp dir.
 * - Driver selection: s3 only with complete config; STORAGE_DRIVER=s3
 *   with incomplete config falls back to local with a warning.
 *   (No real S3 calls are made anywhere in this suite.)
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import productRoutes from '../src/routes/productRoutes.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { generateAccessToken } from '../src/utils/token.js';
import { sniffImageType, imageTypeForMime, IMAGE_TYPES } from '../src/utils/imageSniff.js';
import {
  createLocalDriver,
  createStorage,
  resolveStorageDriverName,
} from '../src/services/storage.js';

// 1x1 transparent PNG (real PNG signature + chunks)
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64'
);
// Minimal JPEG: SOI + APP0 marker bytes are enough for the signature.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
// Minimal WebP: RIFF header + WEBP fourcc.
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
]);

// ── Sniffing ───────────────────────────────────────────────────────────────
describe('SEC-09 — sniffImageType (magic bytes)', () => {
  it('accepts real JPEG, PNG and WebP headers', () => {
    expect(sniffImageType(JPEG_BYTES)).toBe('jpeg');
    expect(sniffImageType(PNG_BYTES)).toBe('png');
    expect(sniffImageType(WEBP_BYTES)).toBe('webp');
  });

  it('rejects text and random bytes', () => {
    expect(sniffImageType(Buffer.from('this is definitely not an image'))).toBeNull();
    expect(sniffImageType(Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]))).toBeNull();
  });

  it('rejects empty, truncated and RIFF-but-not-WebP buffers', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull(); // truncated PNG
    const wave = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE')]);
    expect(sniffImageType(wave)).toBeNull();
    expect(sniffImageType(null)).toBeNull();
  });

  it('maps types to canonical extension/MIME and declared mimetypes to types', () => {
    expect(IMAGE_TYPES[sniffImageType(PNG_BYTES)]).toEqual({ ext: '.png', mime: 'image/png' });
    expect(imageTypeForMime('image/jpeg')).toBe('jpeg');
    expect(imageTypeForMime('image/jpg')).toBe('jpeg');
    expect(imageTypeForMime('image/png')).toBe('png');
    expect(imageTypeForMime('image/webp')).toBe('webp');
    expect(imageTypeForMime('application/octet-stream')).toBeNull();
  });
});

// ── Storage drivers ────────────────────────────────────────────────────────
describe('SEC-09 — local storage driver', () => {
  let dir;
  afterEach(async () => {
    if (dir) await fsp.rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('put/get/getStream/delete round-trip in a temp dir', async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hao-storage-'));
    const driver = createLocalDriver({ baseDir: dir });

    const put = await driver.put('prod_test.png', PNG_BYTES, 'image/png');
    expect(put.key).toBe('prod_test.png');
    expect(put.url).toBe('/uploads/prod_test.png');
    expect(fs.existsSync(path.join(dir, 'prod_test.png'))).toBe(true);

    const got = await driver.get('prod_test.png');
    expect(Buffer.compare(got, PNG_BYTES)).toBe(0);

    const stream = await driver.getStream('prod_test.png');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(Buffer.compare(Buffer.concat(chunks), PNG_BYTES)).toBe(0);

    expect(await driver.delete('prod_test.png')).toBe(true);
    expect(fs.existsSync(path.join(dir, 'prod_test.png'))).toBe(false);
    expect(await driver.delete('prod_test.png')).toBe(false); // already gone
  });

  it('rejects path-traversal keys', async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hao-storage-'));
    const driver = createLocalDriver({ baseDir: dir });
    await expect(driver.put('../escape.png', PNG_BYTES, 'image/png')).rejects.toThrow(/Invalid storage key/);
  });
});

describe('SEC-09 — storage driver selection', () => {
  it('defaults to local', () => {
    expect(resolveStorageDriverName({})).toBe('local');
    expect(resolveStorageDriverName({ STORAGE_DRIVER: 'local', S3_BUCKET: 'b', S3_REGION: 'r' })).toBe('local');
  });

  it('selects s3 only when STORAGE_DRIVER=s3 AND bucket+region are set', () => {
    expect(
      resolveStorageDriverName({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_REGION: 'us-east-1' }, vi.fn())
    ).toBe('s3');
  });

  it('falls back to local (with a warning) when s3 config is incomplete', async () => {
    const warn = vi.fn();
    expect(resolveStorageDriverName({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b' }, warn)).toBe('local');
    expect(resolveStorageDriverName({ STORAGE_DRIVER: 's3' }, warn)).toBe('local');
    expect(warn).toHaveBeenCalledTimes(2);

    const service = await createStorage({
      env: { STORAGE_DRIVER: 's3' },
      baseDir: await fsp.mkdtemp(path.join(os.tmpdir(), 'hao-storage-')),
      warn: vi.fn(),
    });
    expect(service.name).toBe('local');
    await fsp.rm(service.baseDir, { recursive: true, force: true });
  });
});

// ── Upload endpoint ────────────────────────────────────────────────────────
function buildTestApp() {
  const app = express();
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/products', productRoutes);
  app.use(globalErrorHandler);
  return app;
}

let mongod;
let app;
let adminToken;
const writtenFiles = [];

const uploadsPathFor = (url) => path.join(process.cwd(), 'uploads', path.basename(url));

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Product.init()]);
  app = buildTestApp();
  const admin = await User.create({
    customerName: 'Upload Admin',
    businessName: 'Upload Corp',
    country: 'Canada',
    phoneNumber: '+1-555-0100',
    address: '123 Test St',
    username: `upl_${Date.now()}`,
    email: `upl_${Date.now()}@example.com`,
    password: 'supersecretpassword1',
    role: 'admin',
  });
  adminToken = generateAccessToken(admin);
}, 60000);

afterAll(async () => {
  for (const f of writtenFiles) await fsp.rm(f, { force: true });
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

describe('SEC-09 — POST /api/products/upload-image', () => {
  it('rejects a fake image (text bytes with an image/png mimetype)', async () => {
    const res = await request(app)
      .post('/api/products/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', Buffer.from('plain text pretending to be a png'), {
        filename: 'evil.png',
        contentType: 'image/png',
      });
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid file type/);
  });

  it('rejects PNG bytes that claim to be JPEG (declared/actual mismatch)', async () => {
    const res = await request(app)
      .post('/api/products/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', PNG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid file type/);
  });

  it('accepts a real PNG and stores it under the sniffed .png extension', async () => {
    const res = await request(app)
      .post('/api/products/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      // Deliberately misleading filename: extension must come from bytes.
      .attach('image', PNG_BYTES, { filename: 'photo.gif', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.url).toMatch(/^\/uploads\/prod_.*\.png$/);

    const filePath = uploadsPathFor(res.body.url);
    writtenFiles.push(filePath);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(Buffer.compare(await fsp.readFile(filePath), PNG_BYTES)).toBe(0);
  });

  it('accepts a real JPEG and stores it as .jpg', async () => {
    const res = await request(app)
      .post('/api/products/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', JPEG_BYTES, { filename: 'photo.jpeg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/prod_.*\.jpg$/);
    writtenFiles.push(uploadsPathFor(res.body.url));
  });

  it('product create with an attached real PNG stores the /uploads URL on the product', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Imaged Hammer')
      .field('sku', `IMG-${Date.now()}`)
      .field('category', 'Tools')
      .attach('images', PNG_BYTES, { filename: 'hammer.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    const imageUrl = res.body.data.images.find((u) => u.startsWith('/uploads/'));
    expect(imageUrl).toMatch(/^\/uploads\/prod_.*\.png$/);
    writtenFiles.push(uploadsPathFor(imageUrl));
  });

  it('product create with a fake image attached is rejected', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Fake Hammer')
      .field('sku', `FAKE-${Date.now()}`)
      .field('category', 'Tools')
      .attach('images', Buffer.from('<script>alert(1)</script>'), {
        filename: 'x.png',
        contentType: 'image/png',
      });
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Invalid file type/);
  });
});
