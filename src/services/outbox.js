import { EmailOutbox } from '../models/EmailOutbox.js';
import { User } from '../models/User.js';
import { sendRawMail } from '../utils/emailService.js';
import { renderEmailTemplate } from '../utils/emailTemplates.js';
import { ORDER_STATES } from '../utils/stateMachine.js';
import { sendOrderConfirmedWhatsApp, sendQuoteReadyWhatsApp } from './messaging.js';
import { logger } from '../utils/logger.js';

/**
 * Email outbox service (FEAT-01, v0.4)
 *
 * Transactional email, decoupled from the request path:
 *
 *   enqueueEmail({ to, template, payload, user })
 *     Renders the template (src/utils/emailTemplates.js) and stores a
 *     'pending' EmailOutbox row. Returns the row, or null when the
 *     recipient user has opted out (user.notifications.email === false)
 *     or the row could not be created. Never throws — email must not
 *     break the order request that triggered it.
 *
 *   processOutbox()
 *     One worker pass: sends every due row through the shared mail
 *     helper (sendRawMail from src/utils/emailService.js, which is the
 *     same sendMail the direct helpers use). Outcomes:
 *       real success        -> status 'sent' (terminal)
 *       simulated success   -> status 'simulated' (terminal, honest:
 *                              no SMTP configured, nothing was delivered,
 *                              and simulated rows are never retried)
 *       failure             -> attempts + 1, lastError recorded,
 *                              nextAttemptAt pushed out by an exponential
 *                              backoff (2^attempts minutes, capped at
 *                              24h); status stays 'pending' until
 *                              attempts reach MAX_ATTEMPTS, then 'failed'.
 *
 *   startOutboxWorker() / stopOutboxWorker()
 *     setInterval(processOutbox, 60s), unref'd so it never keeps the
 *     process alive, and guarded so it can only ever run once.
 */

export const MAX_OUTBOX_ATTEMPTS = 5;
export const OUTBOX_INTERVAL_MS = 60 * 1000;
const MAX_BACKOFF_MINUTES = 24 * 60;

export const backoffMinutes = (attempts) =>
  Math.min(2 ** Math.max(1, attempts), MAX_BACKOFF_MINUTES);

// Resolve the recipient user document when we were handed an id (or a
// partially populated object) so the email preference can be honoured.
const resolveUser = async (user) => {
  if (!user) return null;
  if (typeof user === 'object' && user.notifications && typeof user.notifications.email === 'boolean') {
    return user;
  }
  const id = typeof user === 'object' ? user._id || user.id : user;
  if (!id) return typeof user === 'object' ? user : null;
  try {
    return (await User.findById(id)) || (typeof user === 'object' ? user : null);
  } catch {
    return typeof user === 'object' ? user : null;
  }
};

export const enqueueEmail = async ({ to, template, payload = {}, user } = {}) => {
  try {
    const recipientUser = await resolveUser(user);
    if (recipientUser && recipientUser.notifications?.email === false) {
      logger.info('Email outbox: skipped enqueue — recipient opted out of email notifications', {
        template,
        userId: recipientUser._id?.toString(),
      });
      return null;
    }

    const recipient = to || recipientUser?.email || payload?.email;
    if (!recipient) {
      logger.warn('Email outbox: skipped enqueue — no recipient', { template });
      return null;
    }

    const { subject } = renderEmailTemplate(template, payload);

    return await EmailOutbox.create({
      to: recipient,
      subject,
      template,
      payload,
      user: recipientUser?._id || null,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
    });
  } catch (err) {
    logger.error('Email outbox: failed to enqueue email', { error: err.message, template });
    return null;
  }
};

export const processOutbox = async () => {
  const now = new Date();
  const due = await EmailOutbox.find({
    status: { $in: ['pending', 'failed'] },
    nextAttemptAt: { $lte: now },
    attempts: { $lt: MAX_OUTBOX_ATTEMPTS },
  }).sort({ nextAttemptAt: 1 });

  const summary = { processed: 0, sent: 0, simulated: 0, failed: 0, retried: 0 };

  for (const row of due) {
    summary.processed += 1;
    try {
      const { subject, text, html } = renderEmailTemplate(row.template, row.payload || {});
      const result = await sendRawMail({ to: row.to, subject, text, html });

      if (result?.success && result?.simulated) {
        row.status = 'simulated';
        row.lastError = null;
        summary.simulated += 1;
      } else if (result?.success) {
        row.status = 'sent';
        row.lastError = null;
        summary.sent += 1;
      } else {
        throw new Error(result?.error || 'Unknown mail transport error');
      }
    } catch (err) {
      row.attempts += 1;
      row.lastError = err.message;
      row.nextAttemptAt = new Date(Date.now() + backoffMinutes(row.attempts) * 60 * 1000);
      if (row.attempts >= MAX_OUTBOX_ATTEMPTS) {
        row.status = 'failed';
        summary.failed += 1;
      } else {
        row.status = 'pending';
        summary.retried += 1;
      }
    }
    try {
      await row.save();
    } catch (saveErr) {
      logger.error('Email outbox: failed to persist row outcome', {
        error: saveErr.message,
        outboxId: row._id?.toString(),
      });
    }
  }

  if (summary.processed > 0) {
    logger.info('Email outbox: worker pass complete', summary);
  }
  return summary;
};

let outboxTimer = null;

export const startOutboxWorker = (intervalMs = OUTBOX_INTERVAL_MS) => {
  if (outboxTimer) return outboxTimer;
  outboxTimer = setInterval(() => {
    processOutbox().catch((err) =>
      logger.error('Email outbox: worker pass failed', { error: err.message })
    );
  }, intervalMs);
  if (typeof outboxTimer.unref === 'function') outboxTimer.unref();
  logger.info('Email outbox: worker started', { intervalMs });
  return outboxTimer;
};

export const stopOutboxWorker = () => {
  if (outboxTimer) {
    clearInterval(outboxTimer);
    outboxTimer = null;
  }
};

// ── Convenience enqueue helpers ────────────────────────────────────────────

const orderPayload = (order, extra = {}) => ({
  orderNumber: order?.orderNumber,
  customerName: order?.customerDetails?.customerName,
  businessName: order?.customerDetails?.businessName,
  email: order?.customerDetails?.email,
  status: order?.status,
  totalAmount: order?.totalAmount,
  totalQuantity: order?.totalQuantity,
  currency: order?.currency || 'USD',
  carrier: order?.carrierName || null,
  trackingNumber: order?.trackingNumber || null,
  trackingUrl: order?.trackingUrl || null,
  ...extra,
});

const orderRecipient = (order, user) =>
  order?.customerDetails?.email || (typeof user === 'object' ? user?.email : undefined);

const orderUserRef = (order, user) => user || order?.user || null;

export const enqueueOrderReceived = (order, user) =>
  enqueueEmail({
    to: orderRecipient(order, user),
    template: 'order_received',
    payload: orderPayload(order),
    user: orderUserRef(order, user),
  });

// FEAT-11 (v0.8): the order-confirmed event also fans out to WhatsApp
// (inside this service, so the convert-quote call site is unchanged).
// This helper is the confirmation path for quote conversions; status
// transitions to Confirmed fan out via notifyOrderStatusChanged in
// src/services/notify.js instead — the two paths never both fire for
// one event, so no duplicate MessageLog rows. The messaging service
// never throws and only records a row for opted-in buyers with a
// phone, so the email outcome below is unaffected.
export const enqueueOrderConfirmed = async (order, user) => {
  const row = await enqueueEmail({
    to: orderRecipient(order, user),
    template: 'order_confirmed',
    payload: orderPayload(order, { status: ORDER_STATES.CONFIRMED }),
    user: orderUserRef(order, user),
  });
  await sendOrderConfirmedWhatsApp(order, user);
  return row;
};

export const enqueueOrderStatusChanged = (order, user, newStatus) =>
  enqueueEmail({
    to: orderRecipient(order, user),
    template: 'order_status_changed',
    payload: orderPayload(order, { newStatus: newStatus || order?.status }),
    user: orderUserRef(order, user),
  });

export const enqueueOrderShipped = (order, user) =>
  enqueueEmail({
    to: orderRecipient(order, user),
    template: 'order_shipped',
    payload: orderPayload(order, { status: ORDER_STATES.SHIPPED }),
    user: orderUserRef(order, user),
  });

// FEAT-11 (v0.8): quote-ready also fans out to WhatsApp (template
// quote_ready_v1) under the same opt-in/phone gate as the other
// events; see enqueueOrderConfirmed above.
export const enqueueQuoteReady = async (order, user) => {
  const row = await enqueueEmail({
    to: orderRecipient(order, user),
    template: 'quote_ready',
    payload: orderPayload(order),
    user: orderUserRef(order, user),
  });
  await sendQuoteReadyWhatsApp(order, user);
  return row;
};

// Wired as an export now; the payment call site lives in the invoice
// code path, which is off-limits in this release.
export const enqueuePaymentReceived = (order, user, amount) =>
  enqueueEmail({
    to: orderRecipient(order, user),
    template: 'payment_received',
    payload: orderPayload(order, { amount }),
    user: orderUserRef(order, user),
  });
