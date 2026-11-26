import mongoose from 'mongoose';

// FEAT-15 (v1.0): Webhook subscriptions for the public API.
export const WEBHOOK_EVENTS = [
  'order.created',
  'order.status_changed',
  'order.confirmed',
  'payment.confirmed',
];

const webhookSubscriptionSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    url: { type: String, required: true, trim: true },
    events: { type: [{ type: String, enum: WEBHOOK_EVENTS }], default: [] },
    // Secret-storage decision: delivery signing (HMAC-SHA256) needs the
    // RAW secret at delivery time, so unlike API keys it cannot be stored
    // only as a hash. It is kept in a plain field with `select: false` so
    // it is never loaded (or serialised) by default, and it is exposed via
    // the API exactly once — in the create response. Queries that need it
    // (the delivery engine) must opt in explicitly with .select('+secret').
    secret: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const WebhookSubscription = mongoose.model('WebhookSubscription', webhookSubscriptionSchema);
