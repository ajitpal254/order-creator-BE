/**
 * seedAdmin.test.js
 * SEC-08: seeding must never create an admin with a hard-coded fallback
 * password. Without ADMIN_PASSWORD no admin is created (a warning is
 * logged) and the rest of the seeding still runs. With ADMIN_PASSWORD
 * set, the admin is seeded — idempotently.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { seedDatabase } from '../src/seed/seedData.js';
import { User } from '../src/models/User.js';
import { Finish } from '../src/models/Attributes.js';

let mongod;

const ORIGINAL_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  await Finish.deleteMany({});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL_ADMIN_PASSWORD === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = ORIGINAL_ADMIN_PASSWORD;
  vi.restoreAllMocks();
});

describe('seedDatabase admin seeding (SEC-08)', () => {
  it('creates NO admin user when ADMIN_PASSWORD is unset, and warns', async () => {
    delete process.env.ADMIN_PASSWORD;

    await seedDatabase();

    expect(await User.findOne({ role: 'admin' })).toBeNull();
    expect(await User.countDocuments({})).toBe(0);
    const warnings = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(warnings).toContain('ADMIN_PASSWORD');
    // The rest of the seeding still runs.
    expect(await Finish.countDocuments({})).toBeGreaterThan(0);
  });

  it('seeds the admin when ADMIN_PASSWORD is set, idempotently', async () => {
    process.env.ADMIN_PASSWORD = 'Test-Only-Seed-Password-123!';

    await seedDatabase();
    const admin = await User.findOne({ role: 'admin' });
    expect(admin).not.toBeNull();
    expect(admin.username).toBe(process.env.ADMIN_USERNAME || 'admin');

    // Second run must not create a duplicate admin.
    await seedDatabase();
    expect(await User.countDocuments({ role: 'admin' })).toBe(1);
  });
});
