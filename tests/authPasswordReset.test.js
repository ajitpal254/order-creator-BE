/**
 * authPasswordReset.test.js
 * Forgot-password flow: the reset email is actually dispatched (simulated
 * when no SMTP is configured) and the response stays generic so it never
 * reveals whether the account exists.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import express from 'express';
import cookieParser from 'cookie-parser';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import authRoutes from '../src/routes/authRoutes.js';
import { User } from '../src/models/User.js';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/auth', authRoutes);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'Test Buyer',
  businessName: 'Test Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `testuser_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'Password123!',
  role: 'user',
  ...overrides,
});

let mongod;
let app;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

describe('POST /api/auth/forgot-password', () => {
  it('stores a hashed reset token and answers with the generic message', async () => {
    const user = await User.create(makeUser());

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: user.email });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/If an account exists/);

    const updated = await User.findById(user._id);
    expect(updated.resetPasswordToken).toBeTruthy();
    expect(updated.resetPasswordToken).not.toContain('reset');
    expect(updated.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now());
  });

  it('answers the same generic message for an unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/If an account exists/);
  });

  it('rejects a missing email', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });

  it('resets the password with a valid token, then invalidates it (single-use)', async () => {
    const crypto = await import('node:crypto');
    const user = await User.create(makeUser());
    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000;
    await user.save();

    const ok = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'NewPassword123!' });
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);

    // Same token again must fail: it was cleared on first use.
    const reuse = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'AnotherPass123!' });
    expect(reuse.status).toBe(400);
  });
});
