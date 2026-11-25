import mongoose from 'mongoose';

/**
 * MessageLog (FEAT-11, v0.8)
 *
 * Audit log of outbound messaging sends (WhatsApp via the Meta Cloud
 * API — see src/services/messaging.js). One row per attempted send to
 * a buyer who has opted in (User.notifications.whatsapp === true) and
 * supplied a phone number (User.phone). Buyers who have not opted in,
 * or have no phone, get NO row at all — the absence of a row means "no
 * send was intended", not a skipped send.
 *
 * Status lifecycle (terminal — sends are fire-and-record, no retries):
 *   simulated — WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set,
 *               so nothing was delivered; recorded honestly as its own
 *               state rather than pretending it was sent
 *   sent      — the provider accepted the message (HTTP 200)
 *   failed    — the provider rejected the send or the request threw;
 *               `error` carries the reason. A failed WhatsApp send
 *               NEVER fails the order/notification flow that caused it.
 */
const messageLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ['whatsapp'],
      default: 'whatsapp',
    },
    template: {
      type: String,
      required: true,
      trim: true,
    },
    // Intended send facts: recipient + template parameters (plain
    // order/status facts only — never amounts or financial documents).
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['simulated', 'sent', 'failed'],
      required: true,
      index: true,
    },
    error: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export const MessageLog = mongoose.model('MessageLog', messageLogSchema);
