import express from 'express';
import {
  requestPayment,
  uploadProofHandler,
  confirmPayment,
  rejectPayment,
  listPaymentsForOrder,
  stripeWebhook,
  STAFF_ROLES,
} from '../controllers/paymentController.js';
import { protect, authorizeRoles } from '../middleware/auth.js';
import { uploadProof } from '../middleware/proofUpload.js';

const router = express.Router();

// Public webhook — in server.js this path is wired with express.raw()
// BEFORE the global JSON parser; when this router is mounted in tests,
// the raw parser must be applied for this path the same way. The handler
// rejects non-raw bodies with 400.
router.post('/webhook/stripe', stripeWebhook);

router.post('/request', protect, requestPayment);
router.get('/order/:orderId', protect, listPaymentsForOrder);
router.post('/:id/proof', protect, uploadProof.single('proof'), uploadProofHandler);
router.post('/:id/confirm', protect, authorizeRoles(...STAFF_ROLES), confirmPayment);
router.post('/:id/reject', protect, authorizeRoles(...STAFF_ROLES), rejectPayment);

export default router;
