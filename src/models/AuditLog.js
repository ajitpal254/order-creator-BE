import mongoose from 'mongoose';

/**
 * AuditLog (SEC-10, v0.3)
 *
 * Append-only record of privileged mutations: who did what to which
 * entity, with before/after snapshots, the caller's IP and the request
 * correlation id (req.id). Written via src/utils/audit.js (logAudit),
 * which never throws into the request path — a failed audit write must
 * not fail the underlying mutation.
 *
 * entityId is stored as a string so the admin filter API can match it
 * directly from query parameters regardless of the source id type.
 */
const auditLogSchema = new mongoose.Schema({
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  action: {
    type: String,
    required: true,
    trim: true,
  },
  entityType: {
    type: String,
    required: true,
    trim: true,
  },
  entityId: {
    type: String,
    default: null,
  },
  before: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  after: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  ip: {
    type: String,
    default: null,
  },
  requestId: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Entity history lookups (GET /api/admin/audit-logs?entityType=&entityId=)
auditLogSchema.index({ entityType: 1, entityId: 1 });
// Newest-first listing
auditLogSchema.index({ createdAt: -1 });
// Per-actor history
auditLogSchema.index({ actor: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
