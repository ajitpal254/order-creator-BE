import mongoose from 'mongoose';

/**
 * DeadLetterJob (v1.0, B2 — job queue platform layer)
 *
 * A job that exhausted every retry in src/services/queue.js lands here
 * (one row per dead-lettered job) so a failed background job is never
 * silently lost: the row keeps the job name, the exact payload, how
 * many attempts were made, and the last error, for later inspection
 * or manual replay.
 */
const deadLetterJobSchema = new mongoose.Schema(
  {
    jobName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastError: {
      type: String,
      default: null,
    },
    failedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export const DeadLetterJob = mongoose.model('DeadLetterJob', deadLetterJobSchema);
