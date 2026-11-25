/**
 * errorHandler.test.js
 * SEC-05: global error handler.
 * - 5xx in production → generic "Internal Server Error" + requestId,
 *   internal message must NOT leak.
 * - 5xx outside production → real message stays readable.
 * - Intentional 4xx messages stay as-is, even in production.
 * - CORS rejections → 403 with a generic message, not 500.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';

function buildTestApp() {
  const app = express();
  // Mirror server.js request-ID middleware so req.id is populated.
  app.use((req, res, next) => {
    req.id = 'test-request-id';
    next();
  });
  app.get('/boom', (req, res, next) => {
    const err = new Error('database connection string leaked: mongodb://secret-host');
    err.status = 500;
    next(err);
  });
  app.get('/plain-boom', (req, res, next) => next(new Error('kaboom internal detail')));
  app.get('/bad-input', (req, res, next) => {
    const err = new Error('Quantity must be at least 1');
    err.status = 400;
    next(err);
  });
  app.get('/cors-rejected', (req, res, next) =>
    next(new Error("CORS policy violation: origin 'https://evil.example' is not authorized."))
  );
  app.use(globalErrorHandler);
  return app;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.restoreAllMocks();
});

describe('globalErrorHandler (SEC-05)', () => {
  it('returns the generic message + requestId for a 5xx in production, without leaking internals', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(buildTestApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Internal Server Error');
    expect(res.body.requestId).toBe('test-request-id');
    expect(JSON.stringify(res.body)).not.toContain('secret-host');
  });

  it('returns the generic message for a status-less error (500) in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(buildTestApp()).get('/plain-boom');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal Server Error');
    expect(JSON.stringify(res.body)).not.toContain('kaboom');
  });

  it('keeps the real message readable outside production', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(buildTestApp()).get('/plain-boom');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('kaboom internal detail');
    expect(res.body.requestId).toBe('test-request-id');
  });

  it('keeps intentional 4xx messages as-is in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(buildTestApp()).get('/bad-input');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Quantity must be at least 1');
  });

  it('maps CORS rejections to 403 with a generic message, not 500', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(buildTestApp()).get('/cors-rejected');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Origin not authorized');
    expect(JSON.stringify(res.body)).not.toContain('evil.example');
  });
});
