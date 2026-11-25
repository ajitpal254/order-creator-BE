/**
 * FEAT-09 (v0.7) — estimated ship date.
 *
 * Computed at serialization time only (order-detail response): never
 * stored on the order and never part of any totals computation.
 */
import { Product } from '../models/Product.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Estimated ship date for an order: order.createdAt + (max leadTimeDays
 * across the order's products + ORDER_LEAD_BUFFER_DAYS) days.
 *
 * Items whose product is missing, or whose product has a null
 * leadTimeDays, contribute 0. The buffer env var is read per call.
 * Returns null when the order has no items.
 */
export const computeEstimatedShipDate = async (order) => {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return null;
  }

  const productIds = [
    ...new Set(
      order.items
        .map((item) => item.product)
        .filter(Boolean)
        .map((id) => id.toString())
    ),
  ];

  let maxLeadDays = 0;
  if (productIds.length > 0) {
    const products = await Product.find({ _id: { $in: productIds } })
      .select('leadTimeDays')
      .lean();
    for (const product of products) {
      const lead = typeof product.leadTimeDays === 'number' ? product.leadTimeDays : 0;
      if (lead > maxLeadDays) maxLeadDays = lead;
    }
  }

  const bufferDays = parseInt(process.env.ORDER_LEAD_BUFFER_DAYS, 10) || 0;
  const base = order.createdAt ? new Date(order.createdAt) : new Date();
  return new Date(base.getTime() + (maxLeadDays + bufferDays) * DAY_MS);
};
