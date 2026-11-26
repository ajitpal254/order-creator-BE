import crypto from 'crypto';
import { DeadLetterJob } from '../models/DeadLetterJob.js';
import { logger } from '../utils/logger.js';

/**
 * Job queue platform layer (v1.0, B2)
 *
 * Public contract (other workstreams code against exactly this):
 *   registerJobHandler(name, handler)  handler: async (payload) => void
 *   enqueueJob(name, payload?, { delayMs?, attempts? }?) -> job id string
 *   scheduleRecurring(name, everyMs)   enqueue `name` (empty payload)
 *                                      every everyMs; double-scheduling
 *                                      the same name is a no-op
 *   startQueue() / stopQueue()         idempotent lifecycle
 *   getQueueDriver()                   'bullmq' | 'memory'
 *
 * Drivers:
 *   memory (default) — in-process. Delays/retries run on unref'd
 *     setTimeout timers, so the queue never keeps the process alive
 *     and boot needs nothing external. A handler that keeps throwing
 *     is retried with exponential backoff (base * 2^try, capped at
 *     60s) until `attempts` tries are exhausted, then dead-lettered.
 *   bullmq — used ONLY when REDIS_URL is set. BullMQ is loaded with a
 *     lazy dynamic import() inside startQueue(), never at module top
 *     level, so a missing/broken BullMQ or Redis can never break
 *     boot: any failure selecting it logs a warning and falls back
 *     to the memory driver. A single queue ('hao-jobs') carries every
 *     job; one worker dispatches by job name to the registered
 *     handler. Retries/backoff are BullMQ's own; on the final failed
 *     attempt the worker's 'failed' event dead-letters the job too.
 *
 * Dead-lettering (both drivers): a DeadLetterJob row is persisted
 * ({ jobName, payload, attempts, lastError, failedAt }) and an error
 * is logged. If the DB itself is unavailable the row write is logged
 * and swallowed — dead-lettering must never crash the worker.
 *
 * Retry base: 1000ms by default; QUEUE_RETRY_BASE_MS overrides it
 * (tests use a tiny base so retry/exhaustion cases stay fast). An
 * individual enqueueJob call may also pass `retryBaseMs`.
 */

const BULLMQ_QUEUE_NAME = 'hao-jobs';
const DEFAULT_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 60 * 1000;

const retryBaseMs = (override) => {
  if (Number.isFinite(override) && override >= 0) return override;
  const fromEnv = Number(process.env.QUEUE_RETRY_BASE_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0 && process.env.QUEUE_RETRY_BASE_MS !== undefined) {
    return fromEnv;
  }
  return 1000;
};

const backoffMs = (tryNumber, override) =>
  Math.min(retryBaseMs(override) * 2 ** Math.max(0, tryNumber - 1), MAX_BACKOFF_MS);

// ── Registry & state ───────────────────────────────────────────────────────

const handlers = new Map();

let driver = 'memory';
let started = false;

// Memory driver state.
const pendingTimers = new Set();
const recurringTimers = new Map(); // job name -> interval timer

// BullMQ driver state.
let bullQueue = null;
let bullWorker = null;

// Names already given a recurring schedule (either driver), so a
// second scheduleRecurring() for the same job never double-fires it.
const recurringNames = new Set();

export const registerJobHandler = (name, handler) => {
  if (typeof name !== 'string' || !name) throw new Error('registerJobHandler: name is required');
  if (typeof handler !== 'function') throw new Error(`registerJobHandler: handler for '${name}' must be a function`);
  handlers.set(name, handler);
};

export const getQueueDriver = () => driver;

// ── Dead-lettering ─────────────────────────────────────────────────────────

const deadLetter = async (name, payload, attempts, err) => {
  logger.error('Queue: job dead-lettered after exhausting retries', {
    jobName: name,
    attempts,
    error: err?.message || String(err),
  });
  try {
    await DeadLetterJob.create({
      jobName: name,
      payload: payload ?? {},
      attempts,
      lastError: err?.message || String(err),
      failedAt: new Date(),
    });
  } catch (dlErr) {
    logger.error('Queue: failed to persist dead-letter row', {
      jobName: name,
      error: dlErr.message,
    });
  }
};

// ── Memory driver ──────────────────────────────────────────────────────────

const scheduleTimer = (fn, delay) => {
  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    fn();
  }, Math.max(0, delay));
  if (typeof timer.unref === 'function') timer.unref();
  pendingTimers.add(timer);
  return timer;
};

const runMemoryJob = async (name, payload, { attempts, retryBaseOverride, triesMade }) => {
  const handler = handlers.get(name);
  try {
    if (!handler) throw new Error(`No handler registered for job '${name}'`);
    await handler(payload);
  } catch (err) {
    if (triesMade < attempts) {
      const delay = backoffMs(triesMade, retryBaseOverride);
      logger.warn('Queue: job failed, scheduling retry', {
        jobName: name,
        triesMade,
        attempts,
        retryInMs: delay,
        error: err.message,
      });
      scheduleTimer(
        () => runMemoryJob(name, payload, { attempts, retryBaseOverride, triesMade: triesMade + 1 }),
        delay
      );
    } else {
      await deadLetter(name, payload, triesMade, err);
    }
  }
};

const enqueueMemory = (name, payload, { delayMs, attempts, retryBaseOverride }) => {
  const id = crypto.randomUUID();
  scheduleTimer(
    () => runMemoryJob(name, payload, { attempts, retryBaseOverride, triesMade: 1 }),
    delayMs
  );
  return id;
};

// ── BullMQ driver ──────────────────────────────────────────────────────────

// Parse REDIS_URL into BullMQ connection options. Throws on a malformed
// URL — startQueue treats that as "cannot construct a connection" and
// falls back to the memory driver.
const redisConnectionFromUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`Unsupported REDIS_URL protocol: ${url.protocol}`);
  }
  const connection = {
    host: url.hostname || '127.0.0.1',
    port: url.port ? Number(url.port) : 6379,
    // Required by BullMQ workers; also keeps an unreachable Redis from
    // retrying a single command forever inside enqueue/add calls.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };
  if (url.username) connection.username = decodeURIComponent(url.username);
  if (url.password) connection.password = decodeURIComponent(url.password);
  if (url.protocol === 'rediss:') connection.tls = {};
  const db = url.pathname.replace('/', '');
  if (db) connection.db = Number(db);
  return connection;
};

const tryStartBullMq = async () => {
  // Lazy import: BullMQ (and its Redis client) load only on this path.
  const { Queue, Worker } = await import('bullmq');
  const connection = redisConnectionFromUrl(process.env.REDIS_URL);

  const queue = new Queue(BULLMQ_QUEUE_NAME, { connection });
  // A Redis connection error must never become an unhandled 'error'
  // event that crashes the process — log it instead.
  queue.on('error', (err) => logger.error('Queue: BullMQ queue error', { error: err.message }));

  const worker = new Worker(
    BULLMQ_QUEUE_NAME,
    async (job) => {
      const handler = handlers.get(job.name);
      if (!handler) throw new Error(`No handler registered for job '${job.name}'`);
      await handler(job.data);
    },
    { connection }
  );
  worker.on('error', (err) => logger.error('Queue: BullMQ worker error', { error: err.message }));
  worker.on('failed', (job, err) => {
    if (job && job.attemptsMade >= (job.opts?.attempts ?? DEFAULT_ATTEMPTS)) {
      deadLetter(job.name, job.data, job.attemptsMade, err).catch(() => {});
    }
  });

  bullQueue = queue;
  bullWorker = worker;
  return true;
};

// ── Public API ─────────────────────────────────────────────────────────────

export const startQueue = async () => {
  if (started) return;
  started = true;
  driver = 'memory';

  if (process.env.REDIS_URL) {
    try {
      await tryStartBullMq();
      driver = 'bullmq';
      logger.info('Queue: started with BullMQ driver', { queue: BULLMQ_QUEUE_NAME });
      return;
    } catch (err) {
      logger.warn('Queue: BullMQ unavailable, falling back to memory driver', {
        error: err.message,
      });
      bullQueue = null;
      bullWorker = null;
      driver = 'memory';
    }
  }
  logger.info('Queue: started with memory driver');
};

export const stopQueue = async () => {
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
  for (const timer of recurringTimers.values()) clearInterval(timer);
  recurringTimers.clear();
  recurringNames.clear();

  if (bullWorker) {
    try { await bullWorker.close(); } catch { /* already closed */ }
    bullWorker = null;
  }
  if (bullQueue) {
    try { await bullQueue.close(); } catch { /* already closed */ }
    bullQueue = null;
  }
  driver = 'memory';
  started = false;
};

export const enqueueJob = async (name, payload = {}, { delayMs = 0, attempts = DEFAULT_ATTEMPTS, retryBaseMs: retryBaseOverride } = {}) => {
  const totalAttempts = Math.max(1, attempts);
  if (driver === 'bullmq' && bullQueue) {
    const job = await bullQueue.add(name, payload ?? {}, {
      delay: Math.max(0, delayMs),
      attempts: totalAttempts,
      backoff: { type: 'exponential', delay: retryBaseMs(retryBaseOverride) },
    });
    return job.id.toString();
  }
  return enqueueMemory(name, payload ?? {}, {
    delayMs,
    attempts: totalAttempts,
    retryBaseOverride,
  });
};

export const scheduleRecurring = (name, everyMs) => {
  if (!everyMs || everyMs <= 0) throw new Error('scheduleRecurring: everyMs must be positive');
  if (recurringNames.has(name)) return;
  recurringNames.add(name);

  if (driver === 'bullmq' && bullQueue) {
    // Repeatable job: a stable jobId makes BullMQ itself dedupe it.
    bullQueue
      .add(name, {}, { repeat: { every: everyMs }, jobId: `recurring-${name}` })
      .catch((err) =>
        logger.error('Queue: failed to schedule recurring job', { jobName: name, error: err.message })
      );
    return;
  }

  const timer = setInterval(() => {
    enqueueJob(name, {}).catch((err) =>
      logger.error('Queue: recurring enqueue failed', { jobName: name, error: err.message })
    );
  }, everyMs);
  if (typeof timer.unref === 'function') timer.unref();
  recurringTimers.set(name, timer);
};
