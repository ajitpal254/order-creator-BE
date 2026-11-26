import { Order } from '../models/Order.js';
import { ORDER_STATES } from './stateMachine.js';
import { generateOrderNumber } from './idGenerator.js';
import { logger } from './logger.js';

/**
 * FEAT-05 (v0.5) — shared Draft-order construction for reorder
 * (POST /api/orders/:id/reorder) and template create-order
 * (POST /api/templates/:id/create-order).
 *
 * This mirrors the persistence step of createOrder in
 * orderController.js — a fresh order number from the atomic Counter
 * (SEC-12, via generateOrderNumber) with the same duplicate-key retry
 * loop — but it NEVER recomputes pricing the way createOrder does
 * (createOrder re-derives unit prices from the Product catalog and the
 * buyer's current tier). Callers pass items and totals copied as stored
 * on the source order/template, so the new Draft carries exactly the
 * prices the buyer originally saw.
 *
 * Invoice safety: creating an Order document has no invoice side
 * effects. Invoice generation only happens inside updateOrderStatus
 * when an order transitions to Confirmed (ensureOrderInvoice) and on
 * the staff retry-invoice route. A Draft saved here keeps the Order
 * schema's null `invoice` defaults and triggers no email/outbox work
 * (createOrder only sends those for non-Draft submissions).
 */

/**
 * Deep-copy an items array (Mongoose subdocuments or plain objects)
 * into plain objects without _id, ready to embed in a new document.
 */
export const deepCopyItems = (items = []) =>
  items.map((item) => {
    const plain = typeof item?.toObject === 'function' ? item.toObject() : { ...item };
    delete plain._id;
    if (plain.snapshot) plain.snapshot = { ...plain.snapshot };
    return plain;
  });

/**
 * Persist a new Draft order from pre-built items/totals.
 *
 * @param {Object} args
 * @param {import('mongoose').Types.ObjectId|string} args.userId - owner of the new Draft
 * @param {string} [args.orderType] - 'Order' | 'Quote'
 * @param {Object[]} args.items - plain item objects (stored prices kept as-is)
 * @param {Object} args.totals - { totalQuantity, subtotalAmount, discountPercent,
 *   discountAmount, totalAmount, estimatedWeightKg, estimatedCartons }
 * @param {string} [args.currency]
 * @param {number} [args.currencyRate]
 * @param {string} [args.incoterm]
 * @param {Object} [args.customerDetails]
 * @param {string} [args.distributorTierSnapshot]
 * @param {string} args.updatedBy - display name for the timeline entry
 * @param {string} args.note - timeline note for the Draft creation entry
 * @returns {Promise<import('mongoose').Document>} the saved Order
 */
export const saveDraftOrder = async ({
  userId,
  orderType = 'Order',
  items,
  totals,
  currency = 'USD',
  currencyRate = 1.0,
  incoterm = 'FOB',
  customerDetails,
  distributorTierSnapshot = 'Standard',
  updatedBy,
  note,
}) => {
  // Same SEC-12 retry loop as createOrder: on a duplicate-key error
  // (11000) draw the next counter value and retry, up to 5 attempts.
  const MAX_SAVE_ATTEMPTS = 5;
  let order = null;
  let orderNumber = null;
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
    orderNumber = await generateOrderNumber(orderType);
    order = new Order({
      orderNumber,
      orderType,
      user: userId,
      customerDetails,
      items,
      totalQuantity: totals.totalQuantity || 0,
      subtotalAmount: totals.subtotalAmount || 0,
      discountPercent: totals.discountPercent || 0,
      discountAmount: totals.discountAmount || 0,
      totalAmount: totals.totalAmount || 0,
      distributorTierSnapshot,
      currency,
      currencyRate,
      incoterm,
      estimatedWeightKg: totals.estimatedWeightKg || 0,
      estimatedCartons: totals.estimatedCartons || 0,
      status: ORDER_STATES.DRAFT,
      timeline: [
        {
          status: ORDER_STATES.DRAFT,
          updatedBy,
          updatedAt: new Date(),
          note,
        },
      ],
    });
    try {
      await order.save();
      break;
    } catch (saveError) {
      const isDuplicateKey = saveError?.code === 11000;
      if (!isDuplicateKey || attempt === MAX_SAVE_ATTEMPTS - 1) throw saveError;
      logger.warn(
        `Duplicate order number ${orderNumber} (attempt ${attempt + 1}); retrying with next counter value`
      );
    }
  }
  logger.info(`Draft order saved: ${orderNumber}`, { orderId: order._id, userId });
  return order;
};
