/**
 * Handlers for the meta endpoints wired in src/server.js:
 *  - GET /api/ready — readiness probe (QOL-06)
 *  - GET /api/docs  — OpenAPI spec, non-production only (QOL-05)
 *
 * Kept in their own module so tests can mount them without importing
 * server.js (which connects to the DB and starts listening on import).
 */
import mongoose from 'mongoose';
import { buildOpenApiSpec } from './openapi.js';

/**
 * Readiness: 200 only when Mongoose is connected AND a ping succeeds.
 * Otherwise 503 — orchestrators/load balancers should stop routing.
 */
export const readyHandler = async (req, res) => {
  const connected = mongoose.connection.readyState === 1 && Boolean(mongoose.connection.db);
  if (connected) {
    try {
      await mongoose.connection.db.admin().ping();
      return res.status(200).json({ success: true, status: 'ready', db: 'connected' });
    } catch {
      // fall through to 503
    }
  }
  return res.status(503).json({ success: false, status: 'not-ready', db: 'disconnected' });
};

/**
 * OpenAPI spec as JSON. Served ONLY when explicitly enabled with
 * ENABLE_API_DOCS=true AND not in production — the spec is a dev aid,
 * not public surface. (Opt-in flag, not just the NODE_ENV check: a
 * host that forgets NODE_ENV=production must not leak the schema.)
 */
export const docsHandler = (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_API_DOCS !== 'true') {
    return res.status(404).json({
      success: false,
      message: `Endpoint not found: ${req.method} ${req.originalUrl}`,
    });
  }
  return res.status(200).json(buildOpenApiSpec());
};
