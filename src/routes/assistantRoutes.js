import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect } from '../middleware/auth.js';
import {
  postMessage,
  postHandoff,
  postFeedback,
  getFaq,
  deleteConversation,
} from '../controllers/assistantController.js';

/**
 * Assistant routes (FEAT-16, v0.7) — mounted at /api/assistant.
 * ALL routes behind protect + a dedicated per-IP limiter
 * (pattern follows src/routes/trackingRoutes.js / authRoutes.js).
 */
const router = express.Router();

const assistantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many assistant requests. Please try again after 15 minutes.' },
});

router.use(assistantLimiter);
router.use(protect);

router.post('/message', postMessage);
router.post('/handoff', postHandoff);
router.post('/feedback', postFeedback);
router.get('/faq', getFaq);
router.delete('/conversations/:id', deleteConversation);

export default router;
