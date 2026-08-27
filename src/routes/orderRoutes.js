import express from 'express';
import {
  createOrder,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  downloadOrderPdf,
  getAdminStats,
} from '../controllers/orderController.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// User routes
router.post('/', protect, createOrder);
router.get('/my-orders', protect, getMyOrders);

// Admin stats
router.get('/stats/summary', protect, adminOnly, getAdminStats);

// Admin get all
router.get('/', protect, adminOnly, getAllOrders);

// Shared / authorized single order
router.get('/:id', protect, getOrderById);
router.get('/:id/pdf', protect, downloadOrderPdf);

// Admin update status
router.patch('/:id/status', protect, adminOnly, updateOrderStatus);

export default router;
