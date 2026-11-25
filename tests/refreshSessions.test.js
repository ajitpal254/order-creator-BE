/**
 * refreshSessions.test.js
 * SEC-07 (v0.2): refresh tokens are server-side sessions —
 * SHA-256 hashes in the RefreshSession collection, cookie-only
 * presentation, rotation with reuse detection, a 5-session cap,
 * per-session logout, and revoke-all on password reset.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import crypto from 'node:crypto';

import express from 'express';
import cookieParser from 'cookie-parser';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import authRoutes from '../src/routes/authRoutes.js';
import { User } from '../src/models/User.js';
import { RefreshSession } from '../src/models/RefreshSession.js';
import { hashRefreshToken, createRefreshSession } from '../src/utils/token.js';

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

const COOKIE_NAME = 'hao_refresh_token';

const makeUser = (overrides = {}) => ({
  customerName: 'Test Buyer',
  businessName: 'Test Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0100',
  address: '123 Test St',
  username: `testuser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  email: `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`,
  password: 'Password123!',
  role: 'user',
  ...overrides,
});

/** Extract the raw refresh token from a response's Set-Cookie header. */
function refreshCookieValue(res) {
  const cookies = res.headers['set-cookie'] || [];
  const cookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  return cookie.slice(COOKIE_NAME.length + 1).split(';')[0];
}

const withCookie = (raw) => `${COOKIE_NAME}=${raw}`;

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
  await RefreshSession.deleteMany({});
});

async function signupUser() {
  const payload = makeUser();
  const res = await request(app).post('/api/auth/signup').send(payload);
  expect(res.status).toBe(201);
  const user = await User.findOne({ email: payload.email });
  return { payload, res, user, raw: refreshCookieValue(res) };
}

async function loginUser(user) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ usernameOrEmail: user.email, password: 'Password123!' });
  expect(res.status).toBe(200);
  return res;
}

describe('SEC-07 refresh sessions', () => {
  it('login creates a session row (hash only) and sets the cookie, never returning the token in the body', { timeout: 30000 }, async () => {
    const user = await User.create(makeUser());

    const res = await loginUser(user);
    const raw = refreshCookieValue(res);

    expect(raw).toBeTruthy();
    expect(res.headers['set-cookie'].join(' ')).toMatch(/HttpOnly/i);
    expect(res.body.refreshToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(raw);

    const sessions = await RefreshSession.find({ user: user._id });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('active');
    expect(sessions[0].tokenHash).toBe(hashRefreshToken(raw));
    expect(sessions[0].tokenHash).not.toBe(raw);
    expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    // The old plaintext store is gone from the user document.
    const fresh = await User.findById(user._id).lean();
    expect(fresh.refreshTokens).toBeUndefined();
  });

  it('refresh rotates: the new cookie works and the old cookie then fails with 401', { timeout: 30000 }, async () => {
    const { raw } = await signupUser();
    expect(raw).toBeTruthy();

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raw));
    expect(refreshed.status).toBe(200);
    const newRaw = refreshCookieValue(refreshed);
    expect(newRaw).toBeTruthy();
    expect(newRaw).not.toBe(raw);

    // Old session is retained as rotated (for reuse detection).
    const oldSession = await RefreshSession.findOne({ tokenHash: hashRefreshToken(raw) });
    expect(oldSession).toBeTruthy();
    expect(oldSession.status).toBe('rotated');
    expect(String(oldSession.replacedBy)).toBe(
      String((await RefreshSession.findOne({ tokenHash: hashRefreshToken(newRaw) }))._id)
    );

    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raw));
    expect(replay.status).toBe(401);
  });

  it('reusing a rotated token revokes the whole family: a second, still-valid session also dies', { timeout: 30000 }, async () => {
    const { user, raw } = await signupUser();

    // A second, independent session for the same user.
    const { rawToken: raw2 } = await createRefreshSession(user, { userAgent: 'test', ip: '127.0.0.1' });
    expect(await RefreshSession.countDocuments({ user: user._id, status: 'active' })).toBe(2);

    // Rotate session 1 once (legitimate use).
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raw));
    expect(refreshed.status).toBe(200);

    // Replay the rotated token -> reuse detection.
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raw));
    expect(replay.status).toBe(401);

    // Everything is gone, including session 2.
    expect(await RefreshSession.countDocuments({ user: user._id })).toBe(0);

    const second = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raw2));
    expect(second.status).toBe(401);
  });

  it('6th login evicts the oldest active session (cap of 5)', { timeout: 30000 }, async () => {
    const user = await User.create(makeUser());

    const raws = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await loginUser(user);
      raws.push(refreshCookieValue(res));
    }
    expect(new Set(raws).size).toBe(6);

    const active = await RefreshSession.find({ user: user._id, status: 'active' });
    expect(active).toHaveLength(5);
    // The oldest token's row is gone entirely.
    expect(
      await RefreshSession.findOne({ tokenHash: hashRefreshToken(raws[0]) })
    ).toBeNull();

    const evicted = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raws[0]));
    expect(evicted.status).toBe(401);

    const newest = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raws[5]));
    expect(newest.status).toBe(200);
  });

  it('rejects a refresh token supplied in the JSON body (401), even when the token is valid', { timeout: 30000 }, async () => {
    const { user, raw } = await signupUser();

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: raw });
    expect(res.status).toBe(401);

    // The session was not consumed by the body attempt.
    const session = await RefreshSession.findOne({ user: user._id });
    expect(session.status).toBe('active');

    const viaCookie = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raw));
    expect(viaCookie.status).toBe(200);
  });

  it('logout kills only its own session; a second session for the same user still refreshes', { timeout: 30000 }, async () => {
    const { user, raw: raw1 } = await signupUser();

    const loginRes = await loginUser(user);
    const raw2 = refreshCookieValue(loginRes);
    const accessToken = loginRes.body.accessToken;
    expect(await RefreshSession.countDocuments({ user: user._id, status: 'active' })).toBe(2);

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', withCookie(raw2));
    expect(out.status).toBe(200);

    const dead = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raw2));
    expect(dead.status).toBe(401);

    const alive = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', withCookie(raw1));
    expect(alive.status).toBe(200);
  });

  it('password reset revokes all sessions', { timeout: 30000 }, async () => {
    const { user, raw } = await signupUser();
    const { rawToken: raw2 } = await createRefreshSession(user, {});
    expect(await RefreshSession.countDocuments({ user: user._id })).toBe(2);

    const rawReset = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(rawReset).digest('hex');
    user.resetPasswordExpires = Date.now() + 30 * 60 * 1000;
    await user.save();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawReset, newPassword: 'NewPassword123!' });
    expect(res.status).toBe(200);

    expect(await RefreshSession.countDocuments({ user: user._id })).toBe(0);

    for (const old of [raw, raw2]) {
      const attempt = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', withCookie(old));
      expect(attempt.status).toBe(401);
    }
  });
});
