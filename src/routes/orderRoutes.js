import express from 'express';
import {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  downloadOrderPdf,
  getOrderStats,
  getActiveDraft,
  convertQuoteToOrder,
  getBuyerAnalytics,
  retryInvoiceSync,
  reorderOrder,
  getOrderTrackingLink,
} from '../controllers/orderController.js';
import {
  createCounterOffer,
  respondCounterOffer,
  acceptQuote,
  declineQuote,
  downloadQuotePdf,
} from '../controllers/quoteController.js';
import {
  generateOrderDocument,
  listOrderDocuments,
  downloadOrderDocument,
  uploadOrderDocument,
  deleteOrderDocument,
} from '../controllers/orderDocumentController.js';
import { uploadProof } from '../middleware/proofUpload.js';
import { protect, authorizeRoles } from '../middleware/auth.js';
import {
  validate,
  createOrderSchema,
  updateOrderStatusSchema,
  counterOfferSchema,
  respondCounterOfferSchema,
  acceptQuoteSchema,
  declineQuoteSchema,
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

router.post('/', protect, validate({ body: createOrderSchema }), createOrder);
router.get('/my-orders', protect, getMyOrders);
router.get('/draft', protect, getActiveDraft);
router.get('/buyer-analytics', protect, getBuyerAnalytics);
router.get('/stats/overview', protect, authorizeRoles(...staffRoles), getOrderStats);
router.get('/:id/pdf', protect, downloadOrderPdf);
router.get('/:id', protect, getOrderById);

// Admin & Staff operations
router.get('/', protect, authorizeRoles(...staffRoles), getAllOrders);
router.patch(
  '/:id/status',
  protect,
  validate({ body: updateOrderStatusSchema }),
  updateOrderStatus
);
router.post(
  '/:id/convert-quote',
  protect,
  authorizeRoles(...staffRoles),
  convertQuoteToOrder
);
router.post(
  '/:id/retry-invoice',
  protect,
  authorizeRoles(...staffRoles),
  retryInvoiceSync
);
// FEAT-05 (v0.5): reorder — owner (or staff) copies an order into a new Draft
router.post('/:id/reorder', protect, reorderOrder);

// FEAT-06 (v0.6): shareable public tracking link — owner or staff only
router.get('/:id/tracking-link', protect, getOrderTrackingLink);

// FEAT-02 (v0.5) quote workflow
router.post(
  '/:id/counter-offer',
  protect,
  validate({ body: counterOfferSchema }),
  createCounterOffer
);
router.post(
  '/:id/counter-offer/:offerId/respond',
  protect,
  authorizeRoles(...staffRoles),
  validate({ body: respondCounterOfferSchema }),
  respondCounterOffer
);
router.post(
  '/:id/quote/accept',
  protect,
  validate({ body: acceptQuoteSchema }),
  acceptQuote
);
router.post(
  '/:id/quote/decline',
  protect,
  validate({ body: declineQuoteSchema }),
  declineQuote
);
router.get('/:id/quote-pdf', protect, downloadQuotePdf);

// FEAT-08 (v0.8): order document vault — export/shipping documents.
// Access follows the standard order rule (owner or staff; another buyer
// gets 404). Uploads reuse the hardened sniffing upload middleware
// (shared with payment proofs: PDF + JPEG/PNG/WebP, stored via the
// storage service). Delete is staff-only.
router.post('/:id/documents/generate', protect, generateOrderDocument);
router.get('/:id/documents', protect, listOrderDocuments);
router.get('/:id/documents/:docId/download', protect, downloadOrderDocument);
router.post('/:id/documents/upload', protect, uploadProof.single('file'), uploadOrderDocument);
router.delete(
  '/:id/documents/:docId',
  protect,
  authorizeRoles(...staffRoles),
  deleteOrderDocument
);

export default router;
