/**
 * envValidation.test.js
 * QOL-03: boot-time env validation.
 * - Production + missing required → throws, listing EVERY missing var.
 * - Production + all required present → ok.
 * - Missing optional vars → warning only, never a throw.
 * - Non-production + missing required → warning only, never a throw.
 */
import { describe, it, expect, vi } from 'vitest';
import { validateEnv, REQUIRED_ENV_VARS, OPTIONAL_ENV_VARS } from '../src/config/validateEnv.js';

const ALL_REQUIRED = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  CLIENT_URL: 'https://example.com',
};

const ALL_OPTIONAL = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'user@example.com',
  SMTP_PASS: 'secret',
  SMTP_FROM: 'orders@example.com',
  EMAIL_FROM: 'orders@example.com',
  FIREBASE_PROJECT_ID: 'demo-project',
};

describe('validateEnv (QOL-03)', () => {
  it('passes in production when every required variable is present', () => {
    const warn = vi.fn();
    const result = validateEnv({ env: { ...ALL_REQUIRED, ...ALL_OPTIONAL }, nodeEnv: 'production', warn });
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual([]);
    expect(result.isProduction).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws in production listing EVERY missing required variable in one error', () => {
    const warn = vi.fn();
    let thrown = null;
    try {
      validateEnv({ env: { ...ALL_OPTIONAL }, nodeEnv: 'production', warn });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    for (const name of REQUIRED_ENV_VARS) {
      expect(thrown.message).toContain(name);
    }
  });

  it('throws in production listing only the actually-missing required variables', () => {
    const env = { ...ALL_REQUIRED, ...ALL_OPTIONAL };
    delete env.JWT_REFRESH_SECRET;
    delete env.CLIENT_URL;
    expect(() => validateEnv({ env, nodeEnv: 'production', warn: vi.fn() })).toThrow(/JWT_REFRESH_SECRET/);
    expect(() => validateEnv({ env, nodeEnv: 'production', warn: vi.fn() })).toThrow(/CLIENT_URL/);
    expect(() => validateEnv({ env, nodeEnv: 'production', warn: vi.fn() })).not.toThrow(/MONGODB_URI/);
  });

  it('treats an empty-string required variable as missing in production', () => {
    const env = { ...ALL_REQUIRED, ...ALL_OPTIONAL, JWT_SECRET: '' };
    expect(() => validateEnv({ env, nodeEnv: 'production', warn: vi.fn() })).toThrow(/JWT_SECRET/);
  });

  it('warns but does not throw when only optional variables are missing in production', () => {
    const warn = vi.fn();
    const result = validateEnv({ env: { ...ALL_REQUIRED }, nodeEnv: 'production', warn });
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual(expect.arrayContaining(OPTIONAL_ENV_VARS));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('SMTP_HOST');
    expect(warn.mock.calls[0][0]).toContain('FIREBASE_PROJECT_ID');
  });

  it('does not throw in non-production even when required variables are missing', () => {
    const warn = vi.fn();
    const result = validateEnv({ env: {}, nodeEnv: 'development', warn });
    expect(result.missingRequired).toEqual(expect.arrayContaining(REQUIRED_ENV_VARS));
    expect(result.isProduction).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('does not throw in the test environment when required variables are missing', () => {
    const warn = vi.fn();
    expect(() => validateEnv({ env: {}, nodeEnv: 'test', warn })).not.toThrow();
  });
});
