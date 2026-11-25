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

router.post('/signup', validate({ body: signupSchema }), signup);
router.post('/login', loginLimiter, validate({ body: loginSchema }), login);
router.post('/google', googleAuth);
router.post('/refresh', refreshTokenHandler);
router.post('/logout', protect, logout);
router.post('/forgot-password', makePasswordResetLimiter(), forgotPassword);
router.post('/reset-password', makePasswordResetLimiter(), resetPassword);

router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

export default router;
