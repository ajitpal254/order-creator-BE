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
} from '../controllers/orderController.js';
import {
  createCounterOffer,
  respondCounterOffer,
  acceptQuote,
  declineQuote,
  downloadQuotePdf,
} from '../controllers/quoteController.js';
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

export default router;
