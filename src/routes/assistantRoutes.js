import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { protect } from '../middleware/auth.js';
import {
  postMessage,
  postHandoff,
  postFeedback,
  getFaq,
  deleteConversation,
  confirmProposal,
  dismissProposal,
  extractPo,
} from '../controllers/assistantController.js';

/**
 * Assistant routes (FEAT-16, v0.7) — mounted at /api/assistant.
 * ALL routes behind protect + a dedicated per-IP limiter
 * (pattern follows src/routes/trackingRoutes.js / authRoutes.js).
 *
 * v1.0 additions (Stages 3+4): proposal confirm/dismiss and PO
 * extraction (multipart, field 'file', ~5MB cap, memory storage —
 * extraction is fully local, nothing is persisted from the upload).
 */
const router = express.Router();

const assistantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many assistant requests. Please try again after 15 minutes.' },
});

const poUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadPoFile = (req, res, next) => {
  poUpload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return next();
  });
};

router.use(assistantLimiter);
router.use(protect);

router.post('/message', postMessage);
router.post('/handoff', postHandoff);
router.post('/feedback', postFeedback);
router.get('/faq', getFaq);
router.delete('/conversations/:id', deleteConversation);
router.post('/proposals/:id/confirm', confirmProposal);
router.post('/proposals/:id/dismiss', dismissProposal);
router.post('/extract-po', uploadPoFile, extractPo);

export default router;
