// FEAT-06 (v0.6): public order-tracking tokens.
//
// A tracking token is a compact, self-contained, HMAC-signed string the
// backend hands to an order owner (or staff) so they can share a public
// tracking link with anyone — no account or login required to view it.
// It is deliberately NOT a JWT: it uses node:crypto only, carries just
// the order id and an expiry, and grants access to exactly one thing
// (the whitelisted public tracking view in trackingController.js).
//
// Format: base64url(JSON {oid, exp}) + '.' + base64url(HMAC-SHA256)
// where exp is a Unix epoch timestamp in milliseconds.
import crypto from 'crypto';

const DEFAULT_TTL_DAYS = 30;

const base64urlEncode = (buf) => Buffer.from(buf).toString('base64url');
const base64urlDecode = (str) => Buffer.from(str, 'base64url');

const sign = (payloadPart, secret) =>
  crypto.createHmac('sha256', secret).update(payloadPart).digest();

/**
 * Create a tracking token for `orderId`.
 * @param {string|ObjectId} orderId
 * @param {{secret?: string, ttlDays?: number}} [opts]
 * @returns {{token: string, expiresAt: Date}}
 */
export const createTrackingToken = (
  orderId,
  { secret = process.env.JWT_SECRET, ttlDays = DEFAULT_TTL_DAYS } = {}
) => {
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const payload = { oid: orderId.toString(), exp: expiresAt.getTime() };
  const payloadPart = base64urlEncode(JSON.stringify(payload));
  const signaturePart = base64urlEncode(sign(payloadPart, secret));
  return { token: `${payloadPart}.${signaturePart}`, expiresAt };
};

/**
 * Verify a tracking token. Returns { orderId } on success, null for any
 * failure (malformed, bad signature, expired). Never throws.
 * @param {string} token
 * @param {{secret?: string}} [opts]
 * @returns {{orderId: string} | null}
 */
export const verifyTrackingToken = (token, { secret = process.env.JWT_SECRET } = {}) => {
  try {
    if (!token || typeof token !== 'string' || !secret) return null;

    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadPart, signaturePart] = parts;
    if (!payloadPart || !signaturePart) return null;

    const expected = sign(payloadPart, secret);
    const provided = base64urlDecode(signaturePart);
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;

    const payload = JSON.parse(base64urlDecode(payloadPart).toString('utf8'));
    if (!payload || typeof payload.oid !== 'string' || !payload.oid) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;

    return { orderId: payload.oid };
  } catch {
    return null;
  }
};
