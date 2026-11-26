import crypto from 'crypto';
import { User } from '../models/User.js';
import {
  metaWhatsAppAdapter,
  normalizePhone,
  sendWhatsAppText,
} from '../services/messaging.js';
import { handleAssistantMessage } from '../services/assistant/assistantService.js';
import { logger } from '../utils/logger.js';

/**
 * WhatsApp assistant channel (FEAT-16 Stage 4b, v1.0)
 * Mounted at /api/assistant/whatsapp — OUTSIDE the JWT-protected
 * assistant router (Meta cannot present a JWT). The channel is
 * ENV-GATED OFF by default:
 *   - GET verification requires WHATSAPP_VERIFY_TOKEN (else 404).
 *   - POST requires the v0.8 adapter to be configured
 *     (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID, else 404).
 *   - When WHATSAPP_APP_SECRET is set, POST signatures
 *     (X-Hub-Signature-256 over the RAW body) are verified.
 *
 * Known senders (User.phone match) talk to the assistant through
 * handleAssistantMessage with the DEFAULT provider resolution (rules
 * unless the deployment configured otherwise — never forced).
 * Unknown senders only ever receive the fixed link-account reply.
 */

export const LINK_ACCOUNT_TEXT =
  'Hello! This WhatsApp number is not linked to an H.A. Overseas account yet. Please add this number in your profile on our website, then message us again and I will be able to help you here.';

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

const findUserByPhone = async (fromDigits) => {
  const target = digitsOnly(fromDigits);
  if (!target) return null;
  const candidates = await User.find({ phone: { $exists: true, $nin: ['', null] } });
  return (
    candidates.find((u) => digitsOnly(normalizePhone(u.phone)) === target) || null
  );
};

export const getWhatsAppWebhook = (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return res.status(404).json({ success: false, message: 'WhatsApp channel is not active' });
  }
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === verifyToken) {
    return res.status(200).send(String(challenge ?? ''));
  }
  return res.status(403).json({ success: false, message: 'Verification failed' });
};

const isValidSignature = (req) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const header = req.headers['x-hub-signature-256'];
  if (!header || typeof header !== 'string') return false;
  const rawBody = req.rawBody;
  if (!rawBody) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const headerBuf = Buffer.from(header);
  if (expectedBuf.length !== headerBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, headerBuf);
};

export const postWhatsAppWebhook = async (req, res) => {
  if (!metaWhatsAppAdapter.isConfigured()) {
    return res.status(404).json({ success: false, message: 'WhatsApp channel is not active' });
  }
  if (process.env.WHATSAPP_APP_SECRET && !isValidSignature(req)) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  // Always 200 to Meta after processing — per-message failures are
  // logged, never surfaced (a non-200 makes Meta retry the batch).
  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
        for (const message of messages) {
          try {
            if (message?.type !== 'text') continue;
            const text = message?.text?.body;
            const from = message?.from;
            if (!from || !text) continue;
            const user = await findUserByPhone(from);
            if (!user) {
              await sendWhatsAppText({ to: from, body: LINK_ACCOUNT_TEXT });
              continue;
            }
            const result = await handleAssistantMessage({ user, message: String(text) });
            await sendWhatsAppText({ user, to: from, body: result.reply });
          } catch (msgErr) {
            logger.error('WhatsApp webhook message failed', { error: msgErr.message });
          }
        }
      }
    }
  } catch (err) {
    logger.error('WhatsApp webhook processing failed', { error: err.message });
  }
  return res.status(200).json({ success: true });
};
