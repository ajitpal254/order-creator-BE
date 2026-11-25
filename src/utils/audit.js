import { AuditLog } from '../models/AuditLog.js';
import { logger } from './logger.js';

/**
 * logAudit (SEC-10, v0.3)
 *
 * Writes one AuditLog row for a privileged mutation. Actor, IP and the
 * request correlation id are read from the request (req.user is set by
 * the protect middleware, req.id by the request-id middleware in
 * server.js).
 *
 * This helper NEVER throws into the request path: auditing is
 * observability, not part of the mutation's contract, so any failure is
 * logged and swallowed.
 *
 * @param {import('express').Request} req
 * @param {{ action: string, entityType: string, entityId?: any, before?: any, after?: any }} entry
 * @returns {Promise<object|null>} the created document, or null on failure
 */
export const logAudit = async (req, { action, entityType, entityId, before, after } = {}) => {
  try {
    return await AuditLog.create({
      actor: req?.user?._id || null,
      action,
      entityType,
      entityId: entityId != null ? entityId.toString() : null,
      before: before ?? null,
      after: after ?? null,
      ip: req?.ip || null,
      requestId: req?.id || null,
    });
  } catch (err) {
    logger.error('Failed to write audit log', {
      error: err.message,
      action,
      entityType,
      requestId: req?.id || null,
    });
    return null;
  }
};
