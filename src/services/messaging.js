import { MessageLog } from '../models/MessageLog.js';
import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';

/**
 * Messaging service (FEAT-11, v0.8) — WhatsApp notifications, env-gated.
 *
 * Provider interface: an adapter exposes
 *   isConfigured() -> boolean
 *   sendTemplate({ to, template, parameters }) -> { messageId? }
 *     (throws on provider failure)
 *
 * The 'meta' adapter (WhatsApp Cloud API) is implemented below with
 * plain fetch — no new runtime dependency. It is ACTIVE only when both
 * WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set. When either is
 * missing, intended sends are recorded in MessageLog with status
 * 'simulated' — never faked as 'sent'.
 *
 * sendWhatsAppTemplate({ user, template, parameters }) contract:
 *   - Resolves the recipient user (document or id).
 *   - Returns null and writes NO MessageLog row when the buyer has not
 *     opted in (notifications.whatsapp !== true) or has no phone.
 *   - Otherwise writes exactly one MessageLog row: 'sent' on provider
 *     success, 'simulated' when the adapter is not configured, or
 *     'failed' (with `error`) on provider failure.
 *   - NEVER throws: messaging must not break the order/notification
 *     flow that triggered it (same rule as notify() / enqueueEmail()).
 *
 * Template parameters are plain facts only (order number + status
 * facts) — never amounts or financial documents.
 */

const GRAPH_API_BASE = 'https://graph.facebook.com';
const GRAPH_API_VERSION = 'v21.0';

// E.164-ish: leading '+', then 8–15 digits (spaces/hyphens tolerated
// on input and stripped before validation/storage).
export const WHATSAPP_PHONE_PATTERN = /^\+[0-9]{8,15}$/;

export const normalizePhone = (value) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;

export const isValidPhone = (value) =>
  typeof value === 'string' && WHATSAPP_PHONE_PATTERN.test(normalizePhone(value));

// ── Meta WhatsApp Cloud API adapter ────────────────────────────────────────

export const metaWhatsAppAdapter = {
  name: 'meta',

  isConfigured: () =>
    Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),

  async sendTemplate({ to, template, parameters = [] }) {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const url = `${GRAPH_API_BASE}/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: normalizePhone(to),
      type: 'template',
      template: {
        name: template,
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: parameters.map((value) => ({ type: 'text', text: String(value) })),
          },
        ],
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        // Body unreadable — the status alone is the recorded error.
      }
      throw new Error(
        `WhatsApp provider error: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`
      );
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      // A 200 with an unparseable body still counts as accepted.
    }
    return { messageId: data?.messages?.[0]?.id || null };
  },
};

// The active provider. Only 'meta' exists today; SMS is future work
// and intentionally out of scope.
export const getWhatsAppProvider = () => metaWhatsAppAdapter;

// ── Core send ──────────────────────────────────────────────────────────────

// Resolve the recipient user document when handed an id (or a partial
// object) so the opt-in preference and phone can be honoured — same
// pattern as resolveUser in src/services/outbox.js.
const resolveRecipient = async (user) => {
  if (!user) return null;
  if (
    typeof user === 'object' &&
    user.notifications &&
    typeof user.notifications.whatsapp === 'boolean' &&
    'phone' in user
  ) {
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

export const sendWhatsAppTemplate = async ({ user, template, parameters = [] } = {}) => {
  try {
    if (!template) return null;
    const recipient = await resolveRecipient(user);
    if (!recipient) return null;

    // Opt-in gate: no row at all when the buyer has not opted in or
    // has no (valid) phone number on file.
    if (recipient.notifications?.whatsapp !== true) return null;
    if (!isValidPhone(recipient.phone)) return null;

    const to = normalizePhone(recipient.phone);
    const payload = { to, parameters: parameters.map((value) => String(value)) };
    const provider = getWhatsAppProvider();

    if (!provider.isConfigured()) {
      const row = await MessageLog.create({
        user: recipient._id,
        channel: 'whatsapp',
        template,
        payload,
        status: 'simulated',
      });
      logger.info('WhatsApp message simulated (provider not configured)', {
        template,
        userId: recipient._id?.toString(),
      });
      return row;
    }

    try {
      const result = await provider.sendTemplate({ to, template, parameters });
      return await MessageLog.create({
        user: recipient._id,
        channel: 'whatsapp',
        template,
        payload: { ...payload, providerMessageId: result?.messageId || null },
        status: 'sent',
      });
    } catch (providerErr) {
      logger.error('WhatsApp message failed', { error: providerErr.message, template });
      return await MessageLog.create({
        user: recipient._id,
        channel: 'whatsapp',
        template,
        payload,
        status: 'failed',
        error: providerErr.message,
      });
    }
  } catch (err) {
    // Last-resort guard: a logging failure must not break the caller.
    logger.error('WhatsApp messaging failed unexpectedly', { error: err.message, template });
    return null;
  }
};

// ── Event helpers (order/quote facts only — no amounts) ───────────────────

const orderUserRef = (order, user) => user || order?.user || null;

export const sendOrderConfirmedWhatsApp = (order, user) =>
  sendWhatsAppTemplate({
    user: orderUserRef(order, user),
    template: 'order_confirmed_v1',
    parameters: [order?.orderNumber, 'Confirmed'],
  });

export const sendOrderShippedWhatsApp = (order, user) =>
  sendWhatsAppTemplate({
    user: orderUserRef(order, user),
    template: 'order_shipped_v1',
    parameters: [order?.orderNumber, 'Shipped'],
  });

export const sendQuoteReadyWhatsApp = (order, user, fact = 'Ready') =>
  sendWhatsAppTemplate({
    user: orderUserRef(order, user),
    template: 'quote_ready_v1',
    parameters: [order?.orderNumber, fact],
  });
