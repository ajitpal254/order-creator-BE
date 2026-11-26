import mongoose from 'mongoose';

// FEAT-15 (v1.0): one row per webhook delivery attempt series for a
// subscription — the delivery log surfaced to developers.
const webhookDeliverySchema = new mongoose.Schema(
  {
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WebhookSubscription',
      required: true,
      index: true,
    },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    attempts: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'delivered', 'failed'],
      default: 'pending',
      index: true,
    },
    lastStatusCode: { type: Number, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

export const WebhookDelivery = mongoose.model('WebhookDelivery', webhookDeliverySchema);
