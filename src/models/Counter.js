import mongoose from 'mongoose';

/**
 * Counter (SEC-12) — atomic sequence store for human-readable IDs.
 *
 * One document per named sequence (e.g. "order:HAO:2026"). Values are
 * handed out with a single findOneAndUpdate({ $inc }) + upsert, which
 * MongoDB executes atomically per document, so concurrent requests can
 * never receive the same sequence value — unlike the previous
 * Date.now()+Math.random() generation, which could collide.
 */
const counterSchema = new mongoose.Schema({
  // Sequence name, e.g. "order:HAO:2026", "order:RFQ:2026", "payment".
  _id: {
    type: String,
    required: true,
  },
  seq: {
    type: Number,
    default: 0,
  },
});

/**
 * Atomically increment and return the next value for `name`.
 * Retries a few times on duplicate-key (11000): two processes upserting
 * a brand-new sequence at the same instant can race the insert even
 * though the $inc itself is atomic; the loser simply retries and gets
 * the next value.
 */
counterSchema.statics.nextSequence = async function nextSequence(name) {
  const MAX_ATTEMPTS = 5;
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const doc = await this.findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return doc.seq;
    } catch (err) {
      lastError = err;
      if (err?.code !== 11000) throw err;
    }
  }
  throw lastError;
};

export const Counter = mongoose.model('Counter', counterSchema);
