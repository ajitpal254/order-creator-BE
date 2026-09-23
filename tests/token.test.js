import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../src/utils/token.js';

test('Token Utils: Generate and verify access token', () => {
  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    username: 'testbuyer',
    email: 'test@example.com',
    role: 'user',
    customerName: 'Test Buyer',
    businessName: 'Global Tools Corp',
  };

  const token = generateAccessToken(mockUser);
  assert.ok(token);

  const decoded = verifyAccessToken(token);
  assert.equal(decoded.id, mockUser._id);
  assert.equal(decoded.username, mockUser.username);
  assert.equal(decoded.email, mockUser.email);
});

test('Token Utils: Generate and verify refresh token', () => {
  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
  };

  const refreshToken = generateRefreshToken(mockUser);
  assert.ok(refreshToken);

  const decoded = verifyRefreshToken(refreshToken);
  assert.equal(decoded.id, mockUser._id);
});
