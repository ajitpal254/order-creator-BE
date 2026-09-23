import jwt from 'jsonwebtoken';

import crypto from 'crypto';

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
  return jwt.sign({ id: user._id || user.id }, getJwtRefreshSecret(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    algorithm: 'HS256',
  });
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
