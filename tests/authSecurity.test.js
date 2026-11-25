/**
 * authSecurity.test.js
 * v0.1 security hotfix coverage:
 *  - SEC-02: Google sign-in trusts ONLY the verified tokeninfo response
 *    (audience + email_verified enforced, body identity ignored).
 *  - SEC-03: access tokens are no longer accepted via ?token= query string.
 *  - SEC-04: minimum password length 10 (signup + reset) and one generic
 *    login error message for unknown user vs wrong password.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import crypto from 'node:crypto';

import express from 'express';
import cookieParser from 'cookie-parser';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import authRoutes from '../src/routes/authRoutes.js';
import { User } from '../src/models/User.js';
import { generateAccessToken } from '../src/utils/token.js';

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

const PROJECT_ID = 'test-firebase-project';

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

const validTokenData = (overrides = {}) => ({
  aud: PROJECT_ID,
  email_verified: 'true',
  email: 'token.user@example.com',
  sub: 'firebase-uid-123',
  name: 'Token User',
  ...overrides,
});

// The controller verifies via the global fetch() call to Google's
// tokeninfo endpoint — stub that exact call.
function mockTokenInfo(data, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      json: async () => data,
    }))
  );
}

let mongod;
let app;
let originalProjectId;

beforeAll(async () => {
  originalProjectId = process.env.FIREBASE_PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();
});

afterAll(async () => {
  if (originalProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
  else process.env.FIREBASE_PROJECT_ID = originalProjectId;
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SEC-02: POST /api/auth/google', () => {
  it('rejects when the token audience does not match FIREBASE_PROJECT_ID', async () => {
    mockTokenInfo(validTokenData({ aud: 'some-other-project' }));

    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'fake-id-token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects when email_verified is false', async () => {
    mockTokenInfo(validTokenData({ email_verified: 'false' }));

    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'fake-id-token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(await User.countDocuments()).toBe(0);
  });

  it('ignores a different email supplied in the body — token values win', async () => {
    mockTokenInfo(validTokenData());

    const res = await request(app)
      .post('/api/auth/google')
      .send({
        idToken: 'fake-id-token',
        email: 'attacker@example.com',
        customerName: 'Attacker Name',
        firebaseUid: 'attacker-uid',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe('token.user@example.com');

    const created = await User.findOne({ email: 'token.user@example.com' });
    expect(created).toBeTruthy();
    expect(created.firebaseUid).toBe('firebase-uid-123');
    expect(created.customerName).toBe('Token User');
    expect(await User.findOne({ email: 'attacker@example.com' })).toBeNull();
  });

  it('rejects a body-only identity with no idToken (no dev/body-trust path)', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({ email: 'body.only@example.com', firebaseUid: 'body-uid', customerName: 'Body Only' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(await User.countDocuments()).toBe(0);
  });

  it('succeeds with a valid mocked token response', async () => {
    mockTokenInfo(validTokenData());

    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'fake-id-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe('token.user@example.com');
    expect(res.body.accessToken).toBeTruthy();
  });
});

describe('SEC-03: ?token= query-string auth', () => {
  it('rejects ?token= with 401 while the same token works as a Bearer header', async () => {
    const user = await User.create(makeUser());
    const token = generateAccessToken(user);

    const viaQuery = await request(app).get(`/api/auth/me?token=${token}`);
    expect(viaQuery.status).toBe(401);

    const viaBearer = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(viaBearer.status).toBe(200);
    expect(viaBearer.body.success).toBe(true);
    expect(viaBearer.body.user.email).toBe(user.email);
  });
});

describe('SEC-04: password length and login errors', () => {
  it('rejects signup with a password under 10 characters', async () => {
    const payload = makeUser({ password: 'Short1!' });

    const res = await request(app).post('/api/auth/signup').send(payload);

    expect(res.status).toBe(400);
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects reset-password with a new password under 10 characters', async () => {
    const user = await User.create(makeUser());
    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000;
    await user.save();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'Short1!' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns the identical generic message for unknown user and wrong password', async () => {
    const user = await User.create(makeUser());

    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: 'nobody@example.com', password: 'Whatever123!' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe('Invalid email or password');

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ usernameOrEmail: user.email, password: 'WrongPassword123!' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.message).toBe('Invalid email or password');

    expect(unknown.body.message).toBe(wrongPassword.body.message);
  });
});
