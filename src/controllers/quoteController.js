/**
 * Quote workflow controller (FEAT-02, v0.5)
 *
 * Endpoints (all behind `protect`, wired in src/routes/orderRoutes.js):
 *   POST /api/orders/:id/counter-offer                    buyer-owner only
 *   POST /api/orders/:id/counter-offer/:offerId/respond   staff only (route)
 *   POST /api/orders/:id/quote/accept                     buyer-owner only
 *   POST /api/orders/:id/quote/decline                    buyer-owner only
 *   GET  /api/orders/:id/quote-pdf                        owner or staff
 *
 * Decisions:
 * - Quotable statuses for a counter-offer: Draft or Submitted (chosen).
 *   Later statuses mean the quote has already moved into order
 *   fulfilment, where price negotiation no longer applies.
 * - Counter-offer respond contract: body { accept: boolean }, plus
 *   optional validityDays / quoteValidityDate on accept.
 * - Buyer quote acceptance does NOT change order `status`: the state
 *   machine (src/utils/stateMachine.js) has no buyer-driven
 *   Submitted -> Confirmed transition and convert-quote is staff-only.
 *   Acceptance is recorded on the additive `quoteStatus` field
 *   (+ quoteAcceptedAt); staff still convert to a Confirmed order.
 * - Ownership follows SEC-01: a non-staff user touching another user's
 *   order gets 404, not 403.
 * - Staff notification: notify() (src/services/notify.js) only targets a
 *   single user and the codebase has no "notify all staff" pattern, so
 *   staff are reached by email through the outbox to the admin
 *   notification address — the same address pattern used by
 *   sendAdminOrderNotificationEmail in src/utils/emailService.js
 *   (ADMIN_NOTIFICATION_EMAIL, fallback export@haoverseas.com).
 *   The buyer always gets an in-app notify() + an outbox email.
 */
import { Order } from '../models/Order.js';
import { ORDER_STATES } from '../utils/stateMachine.js';
import { logger } from '../utils/logger.js';
import { generateQuotePdf } from '../utils/quotePdf.js';
import { enqueueEmail, enqueueQuoteReady } from '../services/outbox.js';
import { notify } from '../services/notify.js';

const STAFF_ROLES = [
  'admin',
  'sales_manager',
  'production_supervisor',
  'qc_inspector',
  'shipping_officer',
  'super_admin',
];

const QUOTABLE_STATUSES = [ORDER_STATES.DRAFT, ORDER_STATES.SUBMITTED];

const isStaff = (req) => STAFF_ROLES.includes(req.user.role);
const isOwner = (order, req) => order.user.toString() === req.user._id.toString();

// Comms wiring is failure-isolated, mirroring orderController's safeComms.
const safeComms = async (fn, label) => {
  try {
    await fn();
  } catch (err) {
    logger.error(`Comms wiring failed (${label})`, { error: err.message });
  }
};

const adminNotificationEmail = () =>
  process.env.ADMIN_NOTIFICATION_EMAIL || 'export@haoverseas.com';

const quotePayload = (order, extra = {}) => ({
  orderNumber: order.orderNumber,
  customerName: order.customerDetails?.customerName,
  businessName: order.customerDetails?.businessName,
  email: order.customerDetails?.email,
  status: order.status,
  totalAmount: order.totalAmount,
  totalQuantity: order.totalQuantity,
  currency: order.currency || 'USD',
  quoteVersion: order.quoteVersion,
  quoteStatus: order.quoteStatus,
  ...extra,
});

const loadOrder = async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404).json({ success: false, message: 'Order not found' });
    return null;
  }
  return order;
};

// Shared guard for the buyer-only quote actions. Returns the order, or
// null after sending the response.
const loadBuyerOwnedQuote = async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return null;
  if (isStaff(req)) {
    res.status(403).json({
      success: false,
      message: 'This is a buyer action; staff cannot perform it on behalf of the buyer.',
    });
    return null;
  }
  if (!isOwner(order, req)) {
    // SEC-01: another buyer's order is reported as not found.
    res.status(404).json({ success: false, message: 'Order not found' });
    return null;
  }
  if (order.orderType !== 'Quote') {
    res.status(400).json({ success: false, message: 'This document is not a Quote.' });
    return null;
  }
  return order;
};

// @desc Buyer makes a counter-offer on a quote
// @route POST /api/orders/:id/counter-offer
export const createCounterOffer = async (req, res) => {
  try {
    const order = await loadBuyerOwnedQuote(req, res);
    if (!order) return res;

    if (!QUOTABLE_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Counter-offers are only accepted while a quote is Draft or Submitted (current status: ${order.status}).`,
      });
    }
    if (order.quoteStatus !== 'open') {
      return res.status(400).json({
        success: false,
        message: `This quote has already been ${order.quoteStatus} and cannot receive counter-offers.`,
      });
    }

    const { amount, message = '' } = req.body;
    order.counterOffers.push({
      by: req.user._id,
      byRole: req.user.role,
      amount,
      message,
      status: 'pending',
    });
    await order.save();
    const offer = order.counterOffers[order.counterOffers.length - 1];

    const payload = quotePayload(order, { counterAmount: amount, message });
    await safeComms(
      () =>
        notify({
          user: order.user,
          type: 'counter_offer_created',
          title: `Counter-offer sent for quote #${order.orderNumber}`,
          body: `Your counter-offer of ${amount} ${order.currency || 'USD'} for quote #${order.orderNumber} has been sent to our export desk.`,
          link: '/my-orders',
        }),
      'notify counter-offer buyer confirmation'
    );
    await safeComms(
      () => enqueueEmail({ to: order.customerDetails?.email || req.user.email, template: 'counter_offer_received', payload, user: req.user }),
      'enqueue counter-offer buyer email'
    );
    // Staff side: no per-user staff notification pattern exists, so the
    // export desk is alerted via the outbox to the admin address.
    await safeComms(
      () => enqueueEmail({ to: adminNotificationEmail(), template: 'counter_offer_received', payload }),
      'enqueue counter-offer staff email'
    );

    return res.status(201).json({
      success: true,
      message: `Counter-offer submitted for quote #${order.orderNumber}.`,
      counterOffer: offer,
      order,
    });
  } catch (error) {
    logger.error('Error creating counter-offer', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Staff accept/decline a counter-offer
// @route POST /api/orders/:id/counter-offer/:offerId/respond
export const respondCounterOffer = async (req, res) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return res;

    if (order.orderType !== 'Quote') {
      return res.status(400).json({ success: false, message: 'This document is not a Quote.' });
    }

    const offer = order.counterOffers.id(req.params.offerId);
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Counter-offer not found' });
    }
    if (offer.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This counter-offer has already been ${offer.status}.`,
      });
    }

    const { accept, validityDays, quoteValidityDate } = req.body;

    if (accept) {
      offer.status = 'accepted';
      for (const other of order.counterOffers) {
        if (other._id.toString() !== offer._id.toString() && other.status === 'pending') {
          other.status = 'declined';
        }
      }
      // Apply the agreed amount to the order pricing field only.
      order.totalAmount = parseFloat(Number(offer.amount).toFixed(2));
      order.quoteVersion = (order.quoteVersion || 1) + 1;
      if (quoteValidityDate) {
        order.quoteValidityDate = new Date(quoteValidityDate);
      } else if (validityDays) {
        order.quoteValidityDate = new Date(Date.now() + Number(validityDays) * 24 * 60 * 60 * 1000);
      }
      if (order.quoteStatus !== 'open') order.quoteStatus = 'open';
    } else {
      offer.status = 'declined';
    }

    await order.save();

    const payload = quotePayload(order, {
      counterAmount: offer.amount,
      offerAccepted: Boolean(accept),
      action: accept ? 'accept' : 'decline',
    });
    await safeComms(
      () =>
        notify({
          user: order.user,
          type: 'counter_offer_responded',
          title: `Counter-offer ${accept ? 'accepted' : 'declined'} for quote #${order.orderNumber}`,
          body: accept
            ? `Your counter-offer for quote #${order.orderNumber} was accepted. The revised quote total is ${order.totalAmount} ${order.currency || 'USD'} (quote version ${order.quoteVersion}).`
            : `Your counter-offer for quote #${order.orderNumber} was declined. The current quoted total remains unchanged.`,
          link: '/my-orders',
        }),
      'notify counter-offer response'
    );
    await safeComms(
      () => enqueueEmail({ template: 'counter_offer_responded', payload, user: order.user }),
      'enqueue counter-offer response email'
    );
    if (accept) {
      // A revised quote goes back to the buyer: quote-ready email too.
      await safeComms(() => enqueueQuoteReady(order, order.user), 'enqueueQuoteReady on counter-offer accept');
    }

    return res.status(200).json({
      success: true,
      message: accept
        ? `Counter-offer accepted. Quote #${order.orderNumber} revised to version ${order.quoteVersion}.`
        : `Counter-offer declined for quote #${order.orderNumber}.`,
      counterOffer: offer,
      order,
    });
  } catch (error) {
    logger.error('Error responding to counter-offer', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Buyer accepts a quote (records quoteStatus; order status unchanged)
// @route POST /api/orders/:id/quote/accept
export const acceptQuote = async (req, res) => {
  try {
    const order = await loadBuyerOwnedQuote(req, res);
    if (!order) return res;

    if (order.quoteStatus === 'accepted') {
      return res.status(400).json({ success: false, message: 'This quote has already been accepted.' });
    }
    if (order.quoteStatus === 'declined') {
      return res.status(400).json({ success: false, message: 'This quote has been declined and cannot be accepted.' });
    }

    order.quoteStatus = 'accepted';
    order.quoteAcceptedAt = new Date();
    await order.save();

    await safeComms(
      () =>
        notify({
          user: order.user,
          type: 'quote_accepted',
          title: `Quote #${order.orderNumber} accepted`,
          body: `You accepted quote #${order.orderNumber}. Our export desk will convert it into a binding order.`,
          link: '/my-orders',
          // FEAT-11 (v0.8): WhatsApp fan-out handled inside notify();
          // the quote_ready_v1 template carries the acceptance fact.
          whatsapp: { template: 'quote_ready_v1', parameters: [order.orderNumber, 'Accepted'] },
        }),
      'notify quote accepted'
    );
    await safeComms(
      () => enqueueEmail({ template: 'quote_accepted', payload: quotePayload(order), user: order.user }),
      'enqueue quote accepted email'
    );
    await safeComms(
      () => enqueueEmail({ to: adminNotificationEmail(), template: 'quote_accepted', payload: quotePayload(order) }),
      'enqueue quote accepted staff email'
    );

    return res.status(200).json({
      success: true,
      message: `Quote #${order.orderNumber} accepted.`,
      order,
    });
  } catch (error) {
    logger.error('Error accepting quote', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Buyer declines a quote
// @route POST /api/orders/:id/quote/decline
export const declineQuote = async (req, res) => {
  try {
    const order = await loadBuyerOwnedQuote(req, res);
    if (!order) return res;

    if (order.quoteStatus === 'declined') {
      return res.status(400).json({ success: false, message: 'This quote has already been declined.' });
    }
    if (order.quoteStatus === 'accepted') {
      return res.status(400).json({ success: false, message: 'This quote has been accepted and cannot be declined.' });
    }

    const { reason = '' } = req.body || {};
    order.quoteStatus = 'declined';
    order.quoteDeclineReason = reason;
    await order.save();

    await safeComms(
      () =>
        notify({
          user: order.user,
          type: 'quote_declined',
          title: `Quote #${order.orderNumber} declined`,
          body: `You declined quote #${order.orderNumber}.${reason ? ` Reason: ${reason}` : ''}`,
          link: '/my-orders',
        }),
      'notify quote declined'
    );
    await safeComms(
      () => enqueueEmail({ template: 'quote_declined', payload: quotePayload(order, { reason }), user: order.user }),
      'enqueue quote declined email'
    );

    return res.status(200).json({
      success: true,
      message: `Quote #${order.orderNumber} declined.`,
      order,
    });
  } catch (error) {
    logger.error('Error declining quote', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Download the formal quotation PDF
// @route GET /api/orders/:id/quote-pdf
export const downloadQuotePdf = async (req, res) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return res;

    if (!isStaff(req) && !isOwner(order, req)) {
      // SEC-01: another buyer's order is reported as not found.
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (order.orderType !== 'Quote') {
      return res.status(400).json({ success: false, message: 'Quote PDF is only available for Quote documents.' });
    }

    const pdfBuffer = await generateQuotePdf(order);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="HAO_Quotation_${order.orderNumber}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    logger.error('Quote PDF Generation Error', { error: error.message });
    return res.status(500).json({ success: false, message: 'Error generating quote PDF: ' + error.message });
  }
};
