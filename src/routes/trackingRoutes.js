import express from 'express';
import rateLimit from 'express-rate-limit';
import { getPublicTracking } from '../controllers/trackingController.js';

const router = express.Router();

// FEAT-06 (v0.6): the tracking endpoint is public, so it gets its own
// per-IP limiter (mirrors the authLimiter pattern in server.js) —
// ~60 requests / 15 min is generous for a human checking a shipment
// but stops token-guessing sweeps.
const trackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many tracking requests. Please try again after 15 minutes.' },
});

router.get('/:token', trackingLimiter, getPublicTracking);

export default router;
