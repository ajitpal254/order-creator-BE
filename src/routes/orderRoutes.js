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
} from '../controllers/orderController.js';
import { protect, authorizeRoles } from '../middleware/auth.js';
import { validate, createOrderSchema, updateOrderStatusSchema } from '../middleware/validate.js';

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

export default router;
