import express from 'express';
import crypto from 'crypto';
import { protect } from '../middleware/auth.js';
import { ApiKey, API_KEY_SCOPES, generateApiKeyPlaintext, hashApiKey } from '../models/ApiKey.js';
import { WebhookSubscription, WEBHOOK_EVENTS } from '../models/WebhookSubscription.js';
import { WebhookDelivery } from '../models/WebhookDelivery.js';

// FEAT-15 (v1.0): developer self-service — API keys + webhook
// subscriptions. JWT-protected; users manage ONLY their own resources
// (another user's resource is a 404, SEC-01 pattern).
const router = express.Router();
router.use(protect);

const validateScopes = (scopes) => {
  if (scopes === undefined) return { value: [] };
  if (!Array.isArray(scopes) || scopes.some((s) => !API_KEY_SCOPES.includes(s))) {
    return { error: `scopes must be an array drawn from: ${API_KEY_SCOPES.join(', ')}` };
  }
  return { value: [...new Set(scopes)] };
};

const validateEvents = (events) => {
  if (!Array.isArray(events) || events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e))) {
    return { error: `events must be a non-empty array drawn from: ${WEBHOOK_EVENTS.join(', ')}` };
  }
  return { value: [...new Set(events)] };
};

const validateHttpsUrl = (url) => {
  if (!url || typeof url !== 'string') return 'A webhook url is required.';
  let parsed;
  try { parsed = new URL(url); } catch { return 'url must be a valid URL.'; }
  if (parsed.protocol !== 'https:') return 'url must be an https URL.';
  return null;
};

const keyMetadata = (k) => ({
  id: k._id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes,
  lastUsedAt: k.lastUsedAt,
  revokedAt: k.revokedAt,
  createdAt: k.createdAt,
});

const subscriptionView = (s) => ({
  id: s._id,
  url: s.url,
  events: s.events,
  active: s.active,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

// ---- API keys ----

router.post('/keys', async (req, res) => {
  try {
    const { name, scopes } = req.body || {};
    const checked = validateScopes(scopes);
    if (checked.error) return res.status(400).json({ success: false, message: checked.error });
    const plaintext = generateApiKeyPlaintext();
    const apiKey = await ApiKey.create({
      owner: req.user._id,
      name: typeof name === 'string' && name.trim() ? name.trim() : 'API Key',
      keyHash: hashApiKey(plaintext),
      prefix: plaintext.slice(0, 8),
      scopes: checked.value,
    });
    // The plaintext key is returned ONCE, here — only its hash is stored.
    return res.status(201).json({
      success: true,
      key: plaintext,
      id: apiKey._id,
      prefix: apiKey.prefix,
      scopes: apiKey.scopes,
      name: apiKey.name,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/keys', async (req, res) => {
  try {
    const keys = await ApiKey.find({ owner: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: keys.map(keyMetadata) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/keys/:id', async (req, res) => {
  try {
    const apiKey = await ApiKey.findOne({ _id: req.params.id, owner: req.user._id }).catch(() => null);
    if (!apiKey) return res.status(404).json({ success: false, message: 'API key not found' });
    if (!apiKey.revokedAt) {
      apiKey.revokedAt = new Date();
      await apiKey.save();
    }
    return res.status(200).json({ success: true, message: 'API key revoked', data: keyMetadata(apiKey) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ---- Webhook subscriptions ----

router.post('/webhooks', async (req, res) => {
  try {
    const { url, events } = req.body || {};
    const urlError = validateHttpsUrl(url);
    if (urlError) return res.status(400).json({ success: false, message: urlError });
    const checked = validateEvents(events);
    if (checked.error) return res.status(400).json({ success: false, message: checked.error });
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const sub = await WebhookSubscription.create({
      owner: req.user._id,
      url: url.trim(),
      events: checked.value,
      secret,
    });
    // The signing secret is returned ONCE, here (see the storage note on
    // the WebhookSubscription model).
    return res.status(201).json({ success: true, data: { ...subscriptionView(sub), secret } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/webhooks', async (req, res) => {
  try {
    const subs = await WebhookSubscription.find({ owner: req.user._id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: subs.map(subscriptionView) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

const loadOwnSubscription = async (req) =>
  WebhookSubscription.findOne({ _id: req.params.id, owner: req.user._id }).catch(() => null);

router.patch('/webhooks/:id', async (req, res) => {
  try {
    const sub = await loadOwnSubscription(req);
    if (!sub) return res.status(404).json({ success: false, message: 'Webhook subscription not found' });
    const { url, events, active } = req.body || {};
    if (url !== undefined) {
      const urlError = validateHttpsUrl(url);
      if (urlError) return res.status(400).json({ success: false, message: urlError });
      sub.url = url.trim();
    }
    if (events !== undefined) {
      const checked = validateEvents(events);
      if (checked.error) return res.status(400).json({ success: false, message: checked.error });
      sub.events = checked.value;
    }
    if (active !== undefined) sub.active = Boolean(active);
    await sub.save();
    return res.status(200).json({ success: true, data: subscriptionView(sub) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/webhooks/:id', async (req, res) => {
  try {
    const sub = await loadOwnSubscription(req);
    if (!sub) return res.status(404).json({ success: false, message: 'Webhook subscription not found' });
    await sub.deleteOne();
    return res.status(200).json({ success: true, message: 'Webhook subscription deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/webhooks/:id/deliveries', async (req, res) => {
  try {
    const sub = await loadOwnSubscription(req);
    if (!sub) return res.status(404).json({ success: false, message: 'Webhook subscription not found' });
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const deliveries = await WebhookDelivery.find({ subscription: sub._id })
      .sort({ createdAt: -1 })
      .limit(limit);
    return res.status(200).json({ success: true, count: deliveries.length, data: deliveries });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
