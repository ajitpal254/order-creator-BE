/**
 * twoFactor.test.js
 * FEAT-13 (v0.4): staff TOTP two-factor authentication.
 *  - Pure node:crypto TOTP against the RFC 6238 SHA-1 test vectors.
 *  - Full flow: setup -> enable -> challenged login -> verify (TOTP and
 *    single-use backup code) -> disable -> plain login again.
 *  - Buyers are never challenged and cannot set up 2FA.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

import express from 'express';
import cookieParser from 'cookie-parser';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import authRoutes from '../src/routes/authRoutes.js';
import { User } from '../src/models/User.js';
import { RefreshSession } from '../src/models/RefreshSession.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { generateAccessToken } from '../src/utils/token.js';
import {
  base32Encode,
  generateTotpSecret,
  totp,
  verifyTotp,
  buildOtpAuthUri,
  generateBackupCodes,
  hashBackupCode,
} from '../src/utils/totp.js';

// token.js reads JWT_SECRET lazily, so setting it here (before any
// token is signed in this file) lets the expired-token test sign a
// challenge token directly.
process.env.JWT_SECRET = 'twofactor-test-secret-at-least-32-chars';

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
  customerName: 'Staff Member',
  businessName: 'H.A. Overseas',
  country: 'India',
  phoneNumber: '+91-555-0100',
  address: '123 Test St',
  username: `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  email: `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`,
  password: 'Password123!',
  role: 'admin',
  ...overrides,
});

function refreshCookieValue(res) {
  const cookies = res.headers['set-cookie'] || [];
  const cookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return cookie ? cookie.slice(COOKIE_NAME.length + 1).split(';')[0] : null;
}

const login = (user) =>
  request(app).post('/api/auth/login').send({ usernameOrEmail: user.email, password: 'Password123!' });

/** A 6-digit code guaranteed not to be valid for `secret` right now. */
function wrongCodeFor(secret) {
  const valid = new Set([-1, 0, 1].map((o) => totp(secret, { timestamp: Date.now() + o * 30000 })));
  let candidate = '000000';
  while (valid.has(candidate)) candidate = String(Number(candidate) + 1).padStart(6, '0');
  return candidate;
}

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
  await AuditLog.deleteMany({});
});

describe('TOTP unit tests (RFC 6238)', () => {
  // ASCII seed from RFC 6238 Appendix B, base32-encoded for our API.
  const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

  it('matches the RFC 6238 SHA-1 test vectors (8-digit)', () => {
    const vectors = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, expected] of vectors) {
      expect(totp(secret, { timestamp: seconds * 1000, digits: 8 })).toBe(expected);
      // The default 6-digit form is the truncation of the same value.
      expect(totp(secret, { timestamp: seconds * 1000 })).toBe(expected.slice(-6));
    }
  });

  it('generates a 32-char base32 secret and a valid otpauth URI', () => {
    const generated = generateTotpSecret();
    expect(generated).toMatch(/^[A-Z2-7]{32}$/);
    const uri = buildOtpAuthUri({ secret: generated, account: 'admin@example.com' });
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(`secret=${generated}`);
    expect(uri).toContain('issuer=H.A.');
  });

  it('verifyTotp accepts ±1 step and rejects a far-off step', () => {
    const now = 1700000000000;
    const current = totp(secret, { timestamp: now });
    expect(verifyTotp(secret, current, { timestamp: now })).toBe(true);
    expect(verifyTotp(secret, current, { timestamp: now + 30000 })).toBe(true);
    expect(verifyTotp(secret, current, { timestamp: now - 30000 })).toBe(true);
    const farOff = totp(secret, { timestamp: now + 10 * 30000 });
    if (farOff !== current) {
      expect(verifyTotp(secret, farOff, { timestamp: now })).toBe(false);
    }
    expect(verifyTotp(secret, 'not-a-code', { timestamp: now })).toBe(false);
  });

  it('backup codes: format and hash normalisation', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    expect(hashBackupCode('abcde-12345')).toBe(hashBackupCode('ABCDE12345'));
    expect(hashBackupCode('abcde-12345')).toBe(hashBackupCode(' abcde 12345 '));
    expect(hashBackupCode('abcde-12345')).not.toBe(hashBackupCode('abcde-12346'));
  });
});

describe('FEAT-13 staff 2FA flow', () => {
  it('full flow: setup -> enable -> challenged login -> verify -> disable -> plain login', { timeout: 30000 }, async () => {
    const user = await User.create(makeUser());

    // Login before 2FA exists: completely unchanged shape + cookie.
    const plain = await login(user);
    expect(plain.status).toBe(200);
    expect(plain.body.requires2fa).toBeUndefined();
    expect(plain.body.accessToken).toBeTruthy();
    expect(refreshCookieValue(plain)).toBeTruthy();
    const accessToken = plain.body.accessToken;
    const auth = { Authorization: `Bearer ${accessToken}` };

    // Setup: secret + otpauth URI, but NOT enabled yet.
    const setup = await request(app).post('/api/auth/2fa/setup').set(auth).send({});
    expect(setup.status).toBe(200);
    expect(setup.body.success).toBe(true);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');
    const secret = setup.body.secret;
    expect((await User.findById(user._id)).twoFactorEnabled).toBe(false);

    // Enable with a fresh TOTP code: 8 plaintext backup codes, once.
    const enable = await request(app)
      .post('/api/auth/2fa/enable')
      .set(auth)
      .send({ code: totp(secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.backupCodes).toHaveLength(8);
    const backupCodes = enable.body.backupCodes;
    const stored = await User.findById(user._id).select('+twoFactorBackupCodes');
    expect(stored.twoFactorEnabled).toBe(true);
    expect(stored.twoFactorBackupCodes).toHaveLength(8);
    expect(stored.twoFactorBackupCodes).not.toContain(backupCodes[0]);
    expect(await AuditLog.findOne({ action: 'auth.2fa_enable' })).toBeTruthy();

    // Password login now returns a challenge and NO session/cookie.
    const challenged = await login(user);
    expect(challenged.status).toBe(200);
    expect(challenged.body).toEqual({
      success: true,
      requires2fa: true,
      challengeToken: expect.any(String),
    });
    expect(refreshCookieValue(challenged)).toBeNull();
    expect(await RefreshSession.countDocuments({ user: user._id })).toBe(1); // only the pre-2FA login

    // Wrong code -> generic 401.
    const wrong = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: challenged.body.challengeToken, code: wrongCodeFor(secret) });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('Invalid authentication code');

    // Verify with a fresh TOTP code completes the normal login.
    const verified = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: challenged.body.challengeToken, code: totp(secret) });
    expect(verified.status).toBe(200);
    expect(verified.body.accessToken).toBeTruthy();
    expect(verified.body.user.email).toBe(user.email);
    expect(refreshCookieValue(verified)).toBeTruthy();

    // Backup code works exactly once.
    const challenge2 = await login(user);
    const viaBackup = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: challenge2.body.challengeToken, code: backupCodes[0] });
    expect(viaBackup.status).toBe(200);
    expect(viaBackup.body.accessToken).toBeTruthy();

    const challenge3 = await login(user);
    const reuse = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: challenge3.body.challengeToken, code: backupCodes[0] });
    expect(reuse.status).toBe(401);

    // Disable with a TOTP code, then login is plain again.
    const disable = await request(app)
      .post('/api/auth/2fa/disable')
      .set(auth)
      .send({ code: totp(secret) });
    expect(disable.status).toBe(200);
    const after = await User.findById(user._id).select('+twoFactorSecret +twoFactorBackupCodes');
    expect(after.twoFactorEnabled).toBe(false);
    expect(after.twoFactorSecret).toBeNull();
    expect(after.twoFactorBackupCodes).toEqual([]);
    expect(await AuditLog.findOne({ action: 'auth.2fa_disable' })).toBeTruthy();

    const plainAgain = await login(user);
    expect(plainAgain.status).toBe(200);
    expect(plainAgain.body.requires2fa).toBeUndefined();
    expect(plainAgain.body.accessToken).toBeTruthy();
    expect(refreshCookieValue(plainAgain)).toBeTruthy();
  });

  it('buyer (non-staff) setup attempt -> 403', async () => {
    const buyer = await User.create(makeUser({ role: 'buyer' }));
    const token = generateAccessToken(buyer);
    const res = await request(app)
      .post('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('user without 2FA: login response shape unchanged', async () => {
    const buyer = await User.create(makeUser({ role: 'user' }));
    const res = await login(buyer);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user).toBeTruthy();
    expect(res.body.requires2fa).toBeUndefined();
    expect(res.body.challengeToken).toBeUndefined();
  });

  it('expired challenge token -> 401, and an access token cannot be used as a challenge token', async () => {
    const user = await User.create(makeUser({ twoFactorEnabled: true }));

    const expired = jwt.sign(
      { sub: user._id.toString(), purpose: '2fa_challenge' },
      process.env.JWT_SECRET,
      { expiresIn: '-10s', algorithm: 'HS256' }
    );
    const expiredRes = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: expired, code: '123456' });
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.message).toBe('Invalid authentication code');

    const accessAsChallenge = await request(app)
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: generateAccessToken(user), code: '123456' });
    expect(accessAsChallenge.status).toBe(401);
  });
});
