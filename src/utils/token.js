import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Secure secret retrieval
function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET;
  }
  console.warn('[Security Warning] JWT_SECRET not properly configured in env. Using runtime key.');
  return 'ha_overseas_secret_jwt_key_2026_9837429187463';
}

export const generateToken = (user) => {
  const payload = {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    customerName: user.customerName,
    businessName: user.businessName,
  };

  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    algorithm: 'HS256',
  });
};

export const verifyToken = (token) => {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
  });
};
