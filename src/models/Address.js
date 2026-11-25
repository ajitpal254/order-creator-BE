import mongoose from 'mongoose';

/**
 * Address (FEAT-05, v0.5)
 *
 * A buyer-owned address-book entry (bill-to / ship-to), managed through
 * /api/addresses. Every endpoint is owner-scoped: another user's
 * address is reported as 404 (SEC-01 pattern).
 */
const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    label: {
      type: String,
      default: '',
      trim: true,
    },
    type: {
      type: String,
      enum: ['bill-to', 'ship-to'],
      default: 'ship-to',
    },
    line1: {
      type: String,
      required: true,
      trim: true,
    },
    line2: {
      type: String,
      default: '',
    },
    city: {
      type: String,
      default: '',
    },
    state: {
      type: String,
      default: '',
    },
    country: {
      type: String,
      default: '',
    },
    postalCode: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Address lists filter { user } newest-first.
addressSchema.index({ user: 1, createdAt: -1 });

export const Address = mongoose.model('Address', addressSchema);
