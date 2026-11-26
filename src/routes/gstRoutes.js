import express from 'express';
import { protect, authorizeRoles } from '../middleware/auth.js';
import { getGstQr, generateIrn, STAFF_ROLES } from '../controllers/gstController.js';
const router = express.Router();
router.get('/:id/gst-qr', protect, getGstQr);
router.post('/:id/irn', protect, authorizeRoles(...STAFF_ROLES), generateIrn);
export default router;
