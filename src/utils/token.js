import jwt from 'jsonwebtoken';

import crypto from 'crypto';

import {
  RefreshSession,
  REFRESH_SESSION_TTL_MS,
  MAX_ACTIVE_SESSIONS_PER_USER,
} from '../models/RefreshSession.js';

let devSecret = null;
let devRefreshSecret = null;

// Secure secret retrieval
function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET environment variable must be at least 16 characters in production!');
  }
  if (!devSecret) {
    devSecret = process.env.DEV_JWT_SECRET || crypto.randomBytes(32).toString('hex');
  }
  return devSecret;
}

function getJwtRefreshSecret() {
  if (process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length >= 16) {
    return process.env.JWT_REFRESH_SECRET;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_REFRESH_SECRET environment variable must be at least 16 characters in production!');
  }
  if (!devRefreshSecret) {
    devRefreshSecret = process.env.DEV_JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');
  }
  return devRefreshSecret;
}

const buildPayload = (user) => ({
  id: user._id || user.id,
  username: user.username,
  email: user.email,
  role: user.role,
  customerName: user.customerName,
  businessName: user.businessName,
});

/**
 * Generates a short-lived access token (15 mins by default)
 */
export const generateAccessToken = (user) => {
  return jwt.sign(buildPayload(user), getJwtSecret(), {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    algorithm: 'HS256',
  });
};

/**
 * Generates a rotating refresh token (7 days by default)
 */
export const generateRefreshToken = (user) => {
  // jti makes every issued token unique even for the same user within
  // the same second — sessions are keyed by token hash, so two logins
  // must never produce identical raw tokens.
  return jwt.sign(
    { id: user._id || user.id, jti: crypto.randomUUID() },
    getJwtRefreshSecret(),
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      algorithm: 'HS256',
    }
  );
};

/** SHA-256 hex digest of a raw refresh token (what we store). */
export const hashRefreshToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

/**
 * Create a RefreshSession row for `user` and return { rawToken, session }.
 * Enforces the per-user cap: creating beyond MAX_ACTIVE_SESSIONS_PER_USER
 * active sessions deletes the oldest active session(s) first.
 */
export const createRefreshSession = async (user, { userAgent = '', ip = '' } = {}) => {
  const userId = user._id || user.id;

  const active = await RefreshSession.find({ user: userId, status: 'active' })
    .sort({ createdAt: 1, _id: 1 })
    .select('_id')
    .lean();
  const excess = active.length - (MAX_ACTIVE_SESSIONS_PER_USER - 1);
  if (excess > 0) {
    const oldestIds = active.slice(0, excess).map((s) => s._id);
    await RefreshSession.deleteMany({ _id: { $in: oldestIds } });
  }

  const rawToken = generateRefreshToken(user);
  const session = await RefreshSession.create({
    user: userId,
    tokenHash: hashRefreshToken(rawToken),
    userAgent: userAgent || '',
    ip: ip || '',
    status: 'active',
    expiresAt: new Date(Date.now() + REFRESH_SESSION_TTL_MS),
  });
  return { rawToken, session };
};

/** Look up a session (any status) by its raw token. */
export const findRefreshSessionByToken = async (rawToken) => {
  if (!rawToken) return null;
  return RefreshSession.findOne({ tokenHash: hashRefreshToken(rawToken) });
};

/** Delete every session belonging to a user (revoke-all paths). */
export const revokeAllRefreshSessions = async (userId) => {
  await RefreshSession.deleteMany({ user: userId });
};

/**
 * Legacy wrapper for single-token callers
 */
export const generateToken = (user) => {
  return generateAccessToken(user);
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
  });
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, getJwtRefreshSecret(), {
    algorithms: ['HS256'],
  });
};

export const verifyToken = (token) => {
  return verifyAccessToken(token);
};
