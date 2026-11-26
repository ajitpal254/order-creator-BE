import { ApiKey, hashApiKey } from '../models/ApiKey.js';
import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';

// FEAT-15 (v1.0): API-key auth for /api/public/v1. The plaintext key
// arrives in the X-API-Key header; we hash it and look the hash up —
// the plaintext is never stored or logged.
export const apiKeyAuth = async (req, res, next) => {
  try {
    const plaintext = req.headers['x-api-key'];
    if (!plaintext) {
      return res.status(401).json({ success: false, message: 'API key missing. Provide it in the X-API-Key header.' });
    }
    const apiKey = await ApiKey.findOne({ keyHash: hashApiKey(plaintext) });
    if (!apiKey || apiKey.revokedAt) {
      return res.status(401).json({ success: false, message: 'Invalid or revoked API key.' });
    }
    const user = await User.findById(apiKey.owner).select('-password');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'API key owner is missing or inactive.' });
    }
    req.apiKey = apiKey;
    req.apiUser = user;
    // Fire-and-forget usage stamp — never block or fail the request on it.
    ApiKey.updateOne({ _id: apiKey._id }, { $set: { lastUsedAt: new Date() } }).catch((err) =>
      logger.warn('Failed to stamp ApiKey.lastUsedAt', { error: err.message })
    );
    return next();
  } catch (error) {
    logger.error('apiKeyAuth error', { error: error.message });
    return res.status(401).json({ success: false, message: 'API key authentication failed.' });
  }
};

export const requireScope = (scope) => (req, res, next) => {
  if (!req.apiKey) {
    return res.status(401).json({ success: false, message: 'API key authentication required.' });
  }
  if (!Array.isArray(req.apiKey.scopes) || !req.apiKey.scopes.includes(scope)) {
    return res.status(403).json({ success: false, message: `API key lacks the required scope: ${scope}` });
  }
  return next();
};
