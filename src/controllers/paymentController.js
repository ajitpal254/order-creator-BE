import crypto from 'crypto';
import { Payment } from '../models/Payment.js';
import { Order } from '../models/Order.js';
import { notify } from '../services/notify.js';
import { enqueueEmail } from '../services/outbox.js';
import { parsePagination, paginatedResponse } from '../utils/paginate.js';
import { logger } from '../utils/logger.js';

export const STAFF_ROLES = [
  'admin',
  'sales_manager',
  'production_supervisor',
  'qc_inspector',
  'shipping_officer',
  'super_admin',
];

export const isStaff = (user) => STAFF_ROLES.includes(user?.role);

const notFound = (res, message = 'Payment not found') =>
  res.status(404).json({ success: false, message });

// Fire notification + email once a payment is confirmed. Both helpers
// never throw. Shared by manual confirm and the Stripe webhook so the
// idempotency guard lives at the call sites (only on transition).
export const firePaymentConfirmed = async (payment) => {
  const order = payment.order && typeof payment.order === 'object' && payment.order.orderNumber
    ? payment.order
    : await Order.findById(payment.order).lean().catch(() => null);
  await notify({
    user: payment.buyer,
    type: 'payment_received',
    title: `Payment received${order?.orderNumber ? ` for order #${order.orderNumber}` : ''}`,
    body: `We have received your payment of ${payment.amount} ${payment.currency || 'USD'}${order?.orderNumber ? ` for order #${order.orderNumber}` : ''}.`,
    link: '/my-orders',
  });
  await enqueueEmail({
    template: 'payment_received',
    payload: {
      orderNumber: order?.orderNumber,
      customerName: order?.customerDetails?.customerName,
      businessName: order?.customerDetails?.businessName,
      email: order?.customerDetails?.email,
      status: order?.status,
      totalAmount: order?.totalAmount,
      currency: payment.currency || order?.currency || 'USD',
      amount: payment.amount,
    },
    user: payment.buyer,
  });
};

// @desc Request a payment for an order
// @route POST /api/payments/request
export const requestPayment = async (req, res) => {
  try {
    const { orderId, amount, method } = req.body || {};
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });
    if (!['card', 'bank_transfer'].includes(method)) {
      return res.status(400).json({ success: false, message: 'method must be card or bank_transfer' });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: 'amount must be greater than 0' });
    }
    const order = await Order.findById(orderId);
    if (!order) return notFound(res, 'Order not found');
    const isOwner = order.user?.toString() === req.user._id.toString();
    if (!isOwner && !isStaff(req.user)) return notFound(res, 'Order not found');

    const currency = order.currency || 'USD';

    if (method === 'card') {
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(503).json({
          success: false,
          code: 'PAYMENTS_NOT_CONFIGURED',
          message: 'Card payments are not configured',
        });
      }
      const payment = await Payment.create({
        order: order._id,
        buyer: order.user,
        amount: numericAmount,
        currency,
        method,
        status: 'initiated',
        createdBy: req.user._id,
      });
      try {
        const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
        const params = new URLSearchParams();
        params.set('mode', 'payment');
        params.set('success_url', `${clientUrl}/payment-success?paymentId=${payment._id}`);
        params.set('cancel_url', `${clientUrl}/payment-cancelled?paymentId=${payment._id}`);
        params.set('payment_method_types[0]', 'card');
        params.set('line_items[0][quantity]', '1');
        params.set('line_items[0][price_data][currency]', currency.toLowerCase());
        params.set('line_items[0][price_data][unit_amount]', String(Math.round(numericAmount * 100)));
        params.set('line_items[0][price_data][product_data][name]', `Order #${order.orderNumber}`);
        params.set('metadata[paymentId]', payment._id.toString());

        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        const session = await stripeRes.json().catch(() => ({}));
        if (!stripeRes.ok || !session.id) {
          payment.status = 'failed';
          await payment.save();
          logger.error('Stripe checkout session creation failed', { status: stripeRes.status });
          return res.status(502).json({ success: false, message: 'Payment provider error' });
        }
        payment.providerRef = session.id;
        await payment.save();
        return res.status(201).json({ success: true, data: { payment, checkoutUrl: session.url || null } });
      } catch (err) {
        payment.status = 'failed';
        await payment.save().catch(() => {});
        logger.error('Stripe checkout error', { error: err.message });
        return res.status(502).json({ success: false, message: 'Payment provider error' });
      }
    }

    // bank_transfer
    const payment = await Payment.create({
      order: order._id,
      buyer: order.user,
      amount: numericAmount,
      currency,
      method,
      status: 'pending_proof',
      createdBy: req.user._id,
    });
    return res.status(201).json({
      success: true,
      data: { payment, instructions: process.env.BANK_TRANSFER_INSTRUCTIONS || '' },
    });
  } catch (error) {
    logger.error('requestPayment error', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @route POST /api/payments/:id/proof
export const uploadProofHandler = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return notFound(res);
    if (payment.buyer?.toString() !== req.user._id.toString()) return notFound(res);
    if (!req.file) return res.status(400).json({ success: false, message: 'Proof file is required' });
    payment.proofFile = req.file.filename;
    payment.proofOriginalName = req.file.originalname || null;
    payment.status = 'proof_submitted';
    await payment.save();
    return res.status(200).json({ success: true, data: { payment } });
  } catch (error) {
    logger.error('uploadProof error', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @route POST /api/payments/:id/confirm
export const confirmPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return notFound(res);
    if (payment.status === 'confirmed') {
      return res.status(200).json({ success: true, data: { payment } });
    }
    if (!['proof_submitted', 'pending_proof', 'initiated'].includes(payment.status)) {
      return res.status(400).json({ success: false, message: `Cannot confirm a payment in status ${payment.status}` });
    }
    payment.status = 'confirmed';
    payment.confirmedBy = req.user._id;
    payment.confirmedAt = new Date();
    await payment.save();
    await firePaymentConfirmed(payment);
    return res.status(200).json({ success: true, data: { payment } });
  } catch (error) {
    logger.error('confirmPayment error', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @route POST /api/payments/:id/reject
export const rejectPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return notFound(res);
    payment.status = 'failed';
    payment.rejectReason = req.body?.reason || '';
    await payment.save();
    const order = await Order.findById(payment.order).lean().catch(() => null);
    await notify({
      user: payment.buyer,
      type: 'payment_failed',
      title: `Payment failed${order?.orderNumber ? ` for order #${order.orderNumber}` : ''}`,
      body: `Your payment of ${payment.amount} ${payment.currency || 'USD'} could not be confirmed.${payment.rejectReason ? ` Reason: ${payment.rejectReason}` : ''}`,
      link: '/my-orders',
    });
    return res.status(200).json({ success: true, data: { payment } });
  } catch (error) {
    logger.error('rejectPayment error', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @route GET /api/payments/order/:orderId
export const listPaymentsForOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return notFound(res, 'Order not found');
    const isOwner = order.user?.toString() === req.user._id.toString();
    if (!isOwner && !isStaff(req.user)) return notFound(res, 'Order not found');
    const { page, limit, skip } = parsePagination(req);
    const filter = { order: order._id };
    const [total, items] = await Promise.all([
      Payment.countDocuments(filter),
      Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);
    return paginatedResponse(res, { items, total, page, limit });
  } catch (error) {
    logger.error('listPaymentsForOrder error', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @route POST /api/payments/webhook/stripe  (public, raw body required)
export const stripeWebhook = async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(501).json({ success: false, message: 'Stripe webhook not configured' });

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : null;
  if (rawBody === null) return res.status(400).json({ success: false, message: 'Raw body required' });

  const sigHeader = req.headers['stripe-signature'] || '';
  let timestamp = null;
  const v1Signatures = [];
  for (const part of String(sigHeader).split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = v;
    if (k === 'v1' && v) v1Signatures.push(v);
  }
  if (!timestamp || v1Signatures.length === 0) {
    return res.status(400).json({ success: false, message: 'Invalid Stripe signature' });
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return res.status(400).json({ success: false, message: 'Stripe signature timestamp outside tolerance' });
  }
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const valid = v1Signatures.some((sig) => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
  if (!valid) return res.status(400).json({ success: false, message: 'Invalid Stripe signature' });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object || {};
      const payment = session.id ? await Payment.findOne({ providerRef: session.id }) : null;
      if (!payment) {
        logger.warn('Stripe webhook: no payment for session', { sessionId: session.id });
      } else if (payment.status !== 'confirmed') {
        payment.status = 'confirmed';
        payment.confirmedAt = new Date();
        await payment.save();
        await firePaymentConfirmed(payment);
      }
    }
  } catch (err) {
    logger.error('Stripe webhook handling error', { error: err.message });
  }
  return res.status(200).json({ received: true });
};
