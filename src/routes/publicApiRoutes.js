import express from 'express';
import rateLimit from 'express-rate-limit';
import { apiKeyAuth, requireScope } from '../middleware/apiKeyAuth.js';
import { getProducts } from '../controllers/productController.js';
import { createOrder, getOrderById } from '../controllers/orderController.js';
import { Order } from '../models/Order.js';

// FEAT-15 (v1.0): public API v1, authenticated by API key (X-API-Key).
// Handlers from the internal API are REUSED, not reimplemented:
//  - products: getProducts is mounted directly (it reads only req.query).
//  - order create: createOrder is mounted directly after a shim sets
//    req.user to the key owner, so pricing/validation stay server-side
//    and identical to the internal path.
//  - order read: an owner pre-check converts the internal handler's
//    non-owner outcome to the public contract (404), then getOrderById
//    produces the response.
const router = express.Router();

// Per-key rate limit: 300 requests / 15 min per API key (PUBLIC_API_RATE_MAX
// overrides — used by tests). Falls back to IP before auth runs.
export const publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => {
    const n = parseInt(process.env.PUBLIC_API_RATE_MAX, 10);
    return Number.isFinite(n) && n > 0 ? n : 300;
  },
  keyGenerator: (req) => req.apiKey?._id?.toString() || req.ip,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  message: { success: false, message: 'Public API rate limit exceeded. Please try again later.' },
});

// Auth runs first so the limiter can key on the API key id.
router.use(apiKeyAuth);
router.use(publicApiLimiter);

// createOrder / getOrderById read req.user — present the key owner as
// the authenticated user so the reused handlers behave exactly as they
// do for a JWT session of that user.
const asApiUser = (req, res, next) => {
  req.user = req.apiUser;
  next();
};

router.get('/products', requireScope('products:read'), getProducts);

router.post('/orders', requireScope('orders:write'), asApiUser, createOrder);

router.get('/orders/:id', requireScope('orders:read'), asApiUser, async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).catch(() => null);
    if (!order || order.user.toString() !== req.apiUser._id.toString()) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    return getOrderById(req, res, next);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
