import express from 'express';
import { protect, adminOnly } from '../middleware/auth.js';
import {
  getRevenueReport,
  getReceivablesAgeing,
  getBacklogReport,
} from '../controllers/reportController.js';

const router = express.Router();

// FEAT-07 (v0.6): admin reports — every route is admin-only and read-only.
router.use(protect, adminOnly);

router.get('/revenue', getRevenueReport);
router.get('/receivables-ageing', getReceivablesAgeing);
router.get('/backlog', getBacklogReport);

export default router;
