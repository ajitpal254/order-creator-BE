import express from 'express';
import { createInternalInvoice } from '../controllers/internalInvoiceController.js';
import { requireInternalKey } from '../middleware/internalAuth.js';

const router = express.Router();

// Internal Machine-to-Machine Invoicing Route
router.post('/invoices', requireInternalKey, createInternalInvoice);

export default router;
