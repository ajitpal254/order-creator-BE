import express from 'express';
import rateLimit from 'express-rate-limit';
import { submitRfq } from '../controllers/rfqController.js';
const router = express.Router();
export const rfqLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: () => {
    const n = parseInt(process.env.RFQ_RATE_LIMIT_MAX, 10);
    return Number.isFinite(n) && n > 0 ? n : 5;
  },
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  message: { success: false, message: 'Too many RFQ submissions. Please try again after an hour.' },
});
router.post('/rfq', rfqLimiter, submitRfq);
export default router;
