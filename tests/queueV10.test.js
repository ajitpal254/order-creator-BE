/**
 * queueV10.test.js
 * v1.0 (B2) — job queue platform layer (src/services/queue.js):
 * - Driver selection: no REDIS_URL -> 'memory'; a malformed REDIS_URL
 *   fails construction, logs a fallback, and still selects 'memory'
 *   (BullMQ is a lazy dynamic import — boot never depends on Redis).
 * - Memory driver executes an enqueued job with its payload.
 * - A handler that fails once then succeeds is retried (2 calls, no
 *   dead letter).
 * - A handler that always throws is retried up to `attempts` tries,
 *   then dead-lettered into a DeadLetterJob row.
 * - scheduleRecurring fires repeatedly on its interval; stopQueue
 *   clears the timers.
 * - Outbox through the queue: an email enqueued via the existing
 *   enqueueEmail helper is processed to 'simulated' (SMTP unset) by
 *   the 'email.outbox.process' built-in job run through the queue.
 * - assistant.cleanup sweeps conversations older than 30 days and
 *   leaves fresh ones alone.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  registerJobHandler,
  enqueueJob,
  scheduleRecurring,
  startQueue,
  stopQueue,
  getQueueDriver,
} from '../src/services/queue.js';
import { registerBuiltinJobs } from '../src/services/jobs.js';
import { DeadLetterJob } from '../src/models/DeadLetterJob.js';
import { EmailOutbox } from '../src/models/EmailOutbox.js';
import { AssistantConversation } from '../src/models/AssistantConversation.js';
import { enqueueEmail } from '../src/services/outbox.js';

const waitFor = async (fn, timeoutMs = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

let mongod;

beforeAll(async () => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.REDIS_URL;
  // Tiny retry base so retry / dead-letter tests stay fast.
  process.env.QUEUE_RETRY_BASE_MS = '10';
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  registerBuiltinJobs();
  await startQueue();
}, 60000);

afterAll(async () => {
  await stopQueue();
  delete process.env.QUEUE_RETRY_BASE_MS;
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await DeadLetterJob.deleteMany({});
  await EmailOutbox.deleteMany({});
});

// ── Driver selection ───────────────────────────────────────────────────────
describe('B2 queue — driver selection', () => {
  it('selects memory when REDIS_URL is unset', () => {
    expect(getQueueDriver()).toBe('memory');
  });

  it('falls back to memory (fast, no hang) when REDIS_URL is malformed', async () => {
    await stopQueue();
    process.env.REDIS_URL = 'not-a-valid-redis-url';
    try {
      await startQueue();
      expect(getQueueDriver()).toBe('memory');
    } finally {
      delete process.env.REDIS_URL;
      await stopQueue();
      await startQueue();
    }
    expect(getQueueDriver()).toBe('memory');
  });

  it('startQueue is idempotent', async () => {
    await startQueue();
    await startQueue();
    expect(getQueueDriver()).toBe('memory');
  });
});

// ── Memory driver execution ────────────────────────────────────────────────
describe('B2 queue — memory driver', () => {
  it('executes an enqueued job with its payload and returns a string id', async () => {
    const seen = [];
    registerJobHandler('test.echo', async (payload) => { seen.push(payload); });
    const id = await enqueueJob('test.echo', { hello: 'world' });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(await waitFor(() => seen.length === 1)).toBe(true);
    expect(seen[0]).toEqual({ hello: 'world' });
  });

  it('retries a handler that fails once, then succeeds — no dead letter', async () => {
    let calls = 0;
    registerJobHandler('test.flaky', async () => {
      calls += 1;
      if (calls === 1) throw new Error('first try boom');
    });
    await enqueueJob('test.flaky', {}, { attempts: 5 });
    expect(await waitFor(() => calls >= 2)).toBe(true);
    // Give any (incorrect) dead-letter write a chance to land.
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(2);
    expect(await DeadLetterJob.countDocuments({ jobName: 'test.flaky' })).toBe(0);
  });

  it('dead-letters after exhausting attempts', async () => {
    let calls = 0;
    registerJobHandler('test.alwaysFails', async () => {
      calls += 1;
      throw new Error('always boom');
    });
    await enqueueJob('test.alwaysFails', { n: 42 }, { attempts: 2 });
    const found = await waitFor(async () => (await DeadLetterJob.countDocuments({ jobName: 'test.alwaysFails' })) === 1);
    expect(found).toBe(true);
    expect(calls).toBe(2);
    const row = await DeadLetterJob.findOne({ jobName: 'test.alwaysFails' });
    expect(row.payload).toEqual({ n: 42 });
    expect(row.attempts).toBe(2);
    expect(row.lastError).toBe('always boom');
    expect(row.failedAt).toBeInstanceOf(Date);
  });
});

// ── Recurring ──────────────────────────────────────────────────────────────
describe('B2 queue — recurring jobs', () => {
  it('fires on its interval, tolerates double-scheduling, and stops with stopQueue', async () => {
    let calls = 0;
    registerJobHandler('test.recurring', async () => { calls += 1; });
    scheduleRecurring('test.recurring', 30);
    scheduleRecurring('test.recurring', 30); // guard: must not double-fire
    expect(await waitFor(() => calls >= 2)).toBe(true);

    await stopQueue();
    const atStop = calls;
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toBe(atStop);

    // Restore the queue for the remaining suites.
    await startQueue();
    expect(getQueueDriver()).toBe('memory');
  });
});

// ── Built-in jobs through the queue ────────────────────────────────────────
describe('B2 queue — built-in jobs', () => {
  it('outbox-through-queue: enqueueEmail row reaches simulated via email.outbox.process', async () => {
    const row = await enqueueEmail({
      to: 'buyer@example.com',
      template: 'order_received',
      payload: { orderNumber: 'HAO-2026-300001' },
    });
    expect(row).not.toBeNull();
    expect(row.status).toBe('pending');

    await enqueueJob('email.outbox.process');
    const done = await waitFor(async () => {
      const after = await EmailOutbox.findById(row._id);
      return after?.status === 'simulated';
    });
    expect(done).toBe(true);
  });

  it('assistant.cleanup deletes conversations older than 30 days only', async () => {
    const coll = mongoose.connection.collection('assistantconversations');
    const userId = new mongoose.Types.ObjectId();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const now = new Date();
    await coll.insertMany([
      { user: userId, messages: [], toolCalls: [], feedback: [], provider: 'rules', createdAt: old, updatedAt: old },
      { user: userId, messages: [], toolCalls: [], feedback: [], provider: 'rules', createdAt: now, updatedAt: now },
    ]);
    expect(await AssistantConversation.countDocuments({})).toBe(2);

    await enqueueJob('assistant.cleanup');
    const done = await waitFor(async () => (await AssistantConversation.countDocuments({})) === 1);
    expect(done).toBe(true);
    const remaining = await AssistantConversation.findOne({});
    expect(remaining.updatedAt.getTime()).toBeGreaterThan(Date.now() - 24 * 60 * 60 * 1000);
    await AssistantConversation.deleteMany({});
  });

  it('registerBuiltinJobs is idempotent', () => {
    expect(() => { registerBuiltinJobs(); registerBuiltinJobs(); }).not.toThrow();
  });
});
