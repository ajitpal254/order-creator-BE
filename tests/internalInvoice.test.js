import test from 'node:test';
import assert from 'node:assert/strict';
import { requireInternalKey } from '../src/middleware/internalAuth.js';

test('Internal Auth: Rejects requests missing X-Internal-Key header', () => {
  process.env.INTERNAL_API_KEY = 'test_secret_key_12345';

  const req = { headers: {} };
  let statusCode = null;
  let jsonPayload = null;

  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (payload) => {
          jsonPayload = payload;
        },
      };
    },
  };

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  requireInternalKey(req, res, next);

  assert.equal(statusCode, 401);
  assert.equal(nextCalled, false);
  assert.equal(jsonPayload.success, false);
});

test('Internal Auth: Accepts requests with valid X-Internal-Key header', () => {
  process.env.INTERNAL_API_KEY = 'test_secret_key_12345';

  const req = {
    headers: {
      'x-internal-key': 'test_secret_key_12345',
    },
  };

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  const res = {};

  requireInternalKey(req, res, next);

  assert.equal(nextCalled, true);
});
