import crypto from 'crypto';
import mongoose from 'mongoose';
import { WebhookSubscription } from '../models/WebhookSubscription.js';
import { WebhookDelivery } from '../models/WebhookDelivery.js';
import { enqueueJob, registerJobHandler } from './queue.js';
import { logger } from '../utils/logger.js';

// FEAT-15 (v1.0): webhook engine. emitWebhookEvent is failure-isolated by
// design — webhooks must never break order/payment flows, so it catches
// and logs every error and never throws.

export const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 10000;

export const emitWebhookEvent = async (ownerId, event, data) => {
  try {
    if (!ownerId || !event) return;
    const subscriptions = await WebhookSubscription.find({
      owner: ownerId,
      active: true,
      events: event,
    }).lean();
    for (const sub of subscriptions) {
      const deliveryId = new mongoose.Types.ObjectId();
      const delivery = await WebhookDelivery.create({
        _id: deliveryId,
        subscription: sub._id,
        owner: ownerId,
        event,
        payload: { id: deliveryId.toString(), event, createdAt: new Date().toISOString(), data },
        status: 'pending',
        attempts: 0,
      });
      await enqueueJob('webhook.deliver', { deliveryId: delivery._id.toString() });
    }
  } catch (err) {
    logger.error('emitWebhookEvent failed', { error: err.message, event });
  }
};

export const processWebhookDelivery = async (deliveryId) => {
  const delivery = await WebhookDelivery.findById(deliveryId);
  if (!delivery) {
    logger.warn('processWebhookDelivery: delivery not found', { deliveryId: String(deliveryId) });
    return null;
  }
  if (delivery.status === 'delivered') return delivery;

  // The signing secret is select:false — opt in explicitly.
  const subscription = await WebhookSubscription.findById(delivery.subscription).select('+secret');
  if (!subscription || !subscription.active) {
    delivery.status = 'failed';
    delivery.lastError = 'Subscription missing or inactive';
    await delivery.save();
    return delivery;
  }

  const rawBody = JSON.stringify(delivery.payload ?? {});
  const signature =
    'sha256=' + crypto.createHmac('sha256', subscription.secret).update(rawBody).digest('hex');

  delivery.attempts += 1;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HAO-Event': delivery.event,
          'X-HAO-Delivery': delivery._id.toString(),
          'X-HAO-Signature': signature,
        },
        body: rawBody,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    delivery.lastStatusCode = response.status;
    if (response.ok) {
      delivery.status = 'delivered';
      delivery.lastError = null;
      await delivery.save();
      return delivery;
    }
    delivery.lastError = `Webhook endpoint responded with HTTP ${response.status}`;
  } catch (err) {
    delivery.lastError = err.name === 'AbortError' ? 'Delivery timed out after 10s' : err.message;
  }

  if (delivery.attempts < MAX_DELIVERY_ATTEMPTS) {
    delivery.status = 'pending';
    await delivery.save();
    const delayMs = Math.min(30_000 * 2 ** delivery.attempts, 30 * 60 * 1000);
    try {
      await enqueueJob(
        'webhook.deliver',
        { deliveryId: delivery._id.toString() },
        { delayMs, attempts: delivery.attempts }
      );
    } catch (err) {
      logger.error('Failed to re-enqueue webhook delivery', { error: err.message, deliveryId: delivery._id.toString() });
    }
  } else {
    delivery.status = 'failed';
    await delivery.save();
  }
  return delivery;
};

// Wire the queue handler at import time (queue contract, FEAT-15).
registerJobHandler('webhook.deliver', async ({ deliveryId }) => processWebhookDelivery(deliveryId));
