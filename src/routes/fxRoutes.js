import express from 'express';
import { getFxRates } from '../controllers/fxController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Logged-in users only — buyers need rates in the order flow.
router.get('/rates', protect, getFxRates);

export default router;
