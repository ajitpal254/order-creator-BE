import mongoose from 'mongoose';

/**
 * EmailOutbox (FEAT-01, v0.4)
 *
 * Transactional email outbox: order lifecycle code enqueues a row here
 * (via src/services/outbox.js) instead of relying solely on a
 * fire-and-forget send, and a background worker (startOutboxWorker)
 * delivers due rows through src/utils/emailService.js.
 *
 * Status lifecycle:
 *   pending   — waiting to be sent, or waiting for a retry backoff
 *   sent      — delivered by a real SMTP transport (terminal)
 *   simulated — no SMTP configured, so the mail service "sent" it in
 *               simulated mode; recorded honestly as its own terminal
 *               state rather than pretending it was delivered
 *   failed    — exhausted MAX attempts (terminal)
 */
const emailOutboxSchema = new mongoose.Schema(
  {
    to: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      default: '',
    },
    template: {
      type: String,
      required: true,
      trim: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Recipient user (when known) — the row exists only when that user
    // has not opted out of email notifications (notifications.email).
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'simulated'],
      default: 'pending',
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    nextAttemptAt: {
      type: Date,
      default: Date.now,
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Worker pickup query: due rows by status + nextAttemptAt.
emailOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

export const EmailOutbox = mongoose.model('EmailOutbox', emailOutboxSchema);
