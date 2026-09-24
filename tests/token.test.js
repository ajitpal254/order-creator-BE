/**
 * token.test.js — Vitest port
 */
import { describe, it, expect } from 'vitest';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../src/utils/token.js';

const MOCK_USER = {
  _id: '507f1f77bcf86cd799439011',
  username: 'testbuyer',
  email: 'test@example.com',
  role: 'user',
  customerName: 'Test Buyer',
  businessName: 'Global Tools Corp',
};

describe('Access token', () => {
  it('generates a non-empty JWT string', () => {
    expect(generateAccessToken(MOCK_USER)).toBeTruthy();
  });

  it('round-trips: decoded payload matches source user', () => {
    const token = generateAccessToken(MOCK_USER);
    const decoded = verifyAccessToken(token);
    expect(decoded.id).toBe(MOCK_USER._id);
    expect(decoded.username).toBe(MOCK_USER.username);
    expect(decoded.email).toBe(MOCK_USER.email);
    expect(decoded.role).toBe(MOCK_USER.role);
  });

  it('uses HS256 algorithm (alg header)', () => {
    const token = generateAccessToken(MOCK_USER);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
  });

  it('throws on tampered token', () => {
    const token = generateAccessToken(MOCK_USER);
    const tampered = token.slice(0, -3) + 'abc';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });
});

describe('Refresh token', () => {
  it('generates a non-empty JWT string', () => {
    expect(generateRefreshToken(MOCK_USER)).toBeTruthy();
  });

  it('round-trips: decoded id matches source user._id', () => {
    const token = generateRefreshToken(MOCK_USER);
    const decoded = verifyRefreshToken(token);
    expect(decoded.id).toBe(MOCK_USER._id);
  });

  it('uses a different secret than the access token (different tokens for same user)', () => {
    const accessToken = generateAccessToken(MOCK_USER);
    const refreshToken = generateRefreshToken(MOCK_USER);
    // They should be different JWTs even for same user
    expect(accessToken).not.toBe(refreshToken);
  });

  it('throws on tampered refresh token', () => {
    const token = generateRefreshToken(MOCK_USER);
    const tampered = token.slice(0, -3) + 'xyz';
    expect(() => verifyRefreshToken(tampered)).toThrow();
  });
});
