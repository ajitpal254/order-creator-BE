import mongoose from 'mongoose';

export const REFRESH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_SESSIONS_PER_USER = 5;

const refreshSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // SHA-256 hex of the raw refresh token. The raw token itself is
    // never stored; it only ever lives in the httpOnly cookie.
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    userAgent: {
      type: String,
      default: '',
    },
    ip: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'rotated', 'revoked'],
      default: 'active',
      index: true,
    },
    // Session created when this one was rotated (null unless rotated).
    replacedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RefreshSession',
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + REFRESH_SESSION_TTL_MS),
    },
  },
  {
    timestamps: true,
  }
);

// TTL: Mongo removes the document once expiresAt passes. Rotated/revoked
// rows therefore stay detectable for reuse detection until expiry.
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshSessionSchema.index({ user: 1, status: 1, createdAt: 1 });

export const RefreshSession = mongoose.model('RefreshSession', refreshSessionSchema);
