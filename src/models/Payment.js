import mongoose from 'mongoose';

/**
 * Payment (FEAT-03, v0.6) — env-gated payments.
 * Association only to Invoice via optional ref; invoice ledger is untouched.
 */
const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: [0.01, 'Amount must be greater than 0'] },
    currency: { type: String, default: 'USD' },
    method: { type: String, enum: ['card', 'bank_transfer'], required: true },
    status: {
      type: String,
      enum: ['initiated', 'pending_proof', 'proof_submitted', 'confirmed', 'failed', 'refunded'],
      default: 'initiated',
      index: true,
    },
    providerRef: { type: String, default: null },
    proofFile: { type: String, default: null },
    proofOriginalName: { type: String, default: null },
    rejectReason: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ order: 1, createdAt: -1 });
paymentSchema.index({ buyer: 1, createdAt: -1 });

export const Payment = mongoose.model('Payment', paymentSchema);
