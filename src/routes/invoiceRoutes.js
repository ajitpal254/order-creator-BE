import express from 'express';
import {
  createInvoice,
  getInvoices,
  getInvoiceById,
  updateInvoice,
  recordPayment,
  voidInvoice,
  downloadInvoicePdf,
} from '../controllers/invoiceController.js';
import { protect, authorizeRoles } from '../middleware/auth.js';
import {
  validate,
  createInvoiceSchema,
  updateInvoiceSchema,
  recordPaymentSchema,
  voidInvoiceSchema,
} from '../middleware/validate.js';

const router = express.Router();

const staffRoles = [
  'admin',
  'sales_manager',
  'production_supervisor',
  'qc_inspector',
  'shipping_officer',
  'super_admin',
];

// Invoices CRUD & Workflow
router.post('/', protect, validate({ body: createInvoiceSchema }), createInvoice);
router.get('/', protect, getInvoices);
router.get('/:id/pdf', protect, downloadInvoicePdf);
router.get('/:id', protect, getInvoiceById);
router.put('/:id', protect, validate({ body: updateInvoiceSchema }), updateInvoice);
router.post(
  '/:id/payments',
  protect,
  authorizeRoles(...staffRoles),
  validate({ body: recordPaymentSchema }),
  recordPayment
);
router.post(
  '/:id/void',
  protect,
  authorizeRoles(...staffRoles),
  validate({ body: voidInvoiceSchema }),
  voidInvoice
);

export default router;
