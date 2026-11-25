import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  signup,
  login,
  googleAuth,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
  refreshTokenHandler,
  logout,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  verifyTwoFactor,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { validate, signupSchema, loginSchema } from '../middleware/validate.js';

const router = express.Router();

// Per-route limiters (SEC-04), on top of the global /api/auth limiter in
// server.js. Each limiter gets its own store so the forgot- and
// reset-password budgets are counted per route.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
});

const makePasswordResetLimiter = () =>
  rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    message: { success: false, message: 'Too many password reset requests. Please try again after an hour.' },
  });

// FEAT-13 (v0.4): strict limiter for the 2FA challenge verify endpoint.
// Failed attempts are what brute force looks like, so successful
// verifications do not consume the budget.
const twoFactorVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Please try again after 15 minutes.' },
});

router.post('/signup', validate({ body: signupSchema }), signup);
router.post('/login', loginLimiter, validate({ body: loginSchema }), login);
router.post('/google', googleAuth);
router.post('/refresh', refreshTokenHandler);
router.post('/logout', protect, logout);
router.post('/forgot-password', makePasswordResetLimiter(), forgotPassword);
router.post('/reset-password', makePasswordResetLimiter(), resetPassword);

router.post('/2fa/setup', protect, setupTwoFactor);
router.post('/2fa/enable', protect, enableTwoFactor);
router.post('/2fa/disable', protect, disableTwoFactor);
router.post('/2fa/verify', twoFactorVerifyLimiter, verifyTwoFactor);

router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

export default router;
