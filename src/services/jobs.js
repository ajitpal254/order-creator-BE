import { registerJobHandler } from './queue.js';
import { processOutbox } from './outbox.js';
import { AssistantConversation } from '../models/AssistantConversation.js';
import { logger } from '../utils/logger.js';

/**
 * Built-in jobs (v1.0, B2)
 *
 * registerBuiltinJobs() wires the jobs this codebase owns into the
 * queue platform layer (src/services/queue.js). It is idempotent —
 * calling it again is a no-op, so boot (and tests) can call it
 * freely without double-registering.
 *
 *   email.outbox.process — one transactional-email outbox pass. This
 *     replaces the old startOutboxWorker() interval: server.js now
 *     schedules this job recurringly at OUTBOX_INTERVAL_MS through
 *     the queue, so the outbox is processed exactly once per interval
 *     by exactly one mechanism. processOutbox() itself is unchanged
 *     (same 'sent'/'simulated'/'failed' statuses, same backoff).
 *   assistant.cleanup — belt-and-braces sweep deleting assistant
 *     conversations untouched for 30+ days. The TTL index on
 *     AssistantConversation.updatedAt normally expires them; this
 *     sweeps by the date field directly in case TTL lag leaves any
 *     behind. Returns the deleted count.
 *
 * Webhook job handlers are NOT registered here — that module
 * self-registers when imported by its routes.
 */

let registered = false;

export const registerBuiltinJobs = () => {
  if (registered) return;
  registered = true;

  registerJobHandler('email.outbox.process', async () => {
    await processOutbox();
  });

  registerJobHandler('assistant.cleanup', async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await AssistantConversation.deleteMany({ updatedAt: { $lt: cutoff } });
    const deleted = result?.deletedCount ?? 0;
    if (deleted > 0) {
      logger.info('Jobs: assistant.cleanup swept stale conversations', { deleted });
    }
    return deleted;
  });
};
