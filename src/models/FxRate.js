import mongoose from 'mongoose';

/**
 * FxRate (FEAT-04, v0.5) — cached ECB reference rates.
 *
 * Singleton-style collection: the FX service keeps exactly one
 * "current" document (upserted on every successful refresh).
 * `rates` is a plain Object of Number (EUR-based: 1 EUR = rates[CUR]
 * units of CUR) so it serialises cleanly to JSON without Map handling.
 */
const fxRateSchema = new mongoose.Schema(
  {
    base: {
      type: String,
      default: 'EUR',
    },
    rates: {
      type: Object,
      default: {},
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export const FxRate = mongoose.model('FxRate', fxRateSchema);
