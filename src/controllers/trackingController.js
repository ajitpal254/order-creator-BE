// FEAT-06 (v0.6): public order tracking.
//
// GET /api/track/:token is PUBLIC (no auth) — the HMAC-signed tracking
// token IS the credential. The response is built by explicitly picking
// whitelisted fields only: order number, status, timeline, and carrier
// shipment details. Prices/totals, buyer identity, addresses, items and
// user ids must NEVER appear here — anyone with the link can read it.
import { Order } from '../models/Order.js';
import { verifyTrackingToken } from '../utils/trackingToken.js';

const NOT_FOUND = { success: false, message: 'Tracking link not found or expired' };

// @desc Public tracking view for a shared tracking token
// @route GET /api/track/:token
export const getPublicTracking = async (req, res) => {
  try {
    const verified = verifyTrackingToken(req.params.token);
    if (!verified) {
      return res.status(404).json(NOT_FOUND);
    }

    const order = await Order.findById(verified.orderId).catch(() => null);
    if (!order) {
      return res.status(404).json(NOT_FOUND);
    }

    // Whitelist: pick fields one by one — never spread the order doc.
    // Timeline entries on the Order model are {status, updatedBy,
    // updatedAt, note}; updatedBy is a user identifier and is dropped,
    // updatedAt is exposed as `at`.
    const data = {
      orderNumber: order.orderNumber,
      status: order.status,
      timeline: (order.timeline || []).map((entry) => {
        const item = { status: entry.status, at: entry.updatedAt };
        if (entry.note) item.note = entry.note;
        return item;
      }),
      carrier: order.carrierName ?? null,
      trackingNumber: order.trackingNumber ?? null,
      trackingUrl: order.trackingUrl ?? null,
    };

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
