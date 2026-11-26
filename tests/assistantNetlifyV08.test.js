/**
 * assistantNetlifyV08.test.js
 * FEAT-16 (v0.8) — Netlify AI Gateway provider (Stage 2):
 * env gate, secret header, redacted payloads, tool-call loop,
 * error wrapping, provider resolution. Fetch is mocked throughout;
 * no network and no database are involved.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { netlifyProvider } from '../src/services/assistant/netlifyProvider.js';
import { AssistantProviderError } from '../src/services/assistant/errors.js';
import { resolveProviderName } from '../src/services/assistant/assistantService.js';

const originalFetch = globalThis.fetch;
const FAKE_SECRET = 'fake-netlify-shared-secret-for-tests';
const FAKE_URL = 'https://example.test/.netlify/functions/assistant-ai';

const jsonResponse = (status, data) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

const completion = (message) => ({ choices: [{ message }] });

const baseArgs = (overrides = {}) => ({
  messages: [{ role: 'user', content: 'Where is my order?' }],
  executeTool: vi.fn(async () => ({})),
  toolSchemas: [
    {
      name: 'get_order_status',
      description: 'Get the status of an order',
      parameters: { type: 'object', properties: { orderId: { type: 'string' } } },
    },
  ],
  ...overrides,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.NETLIFY_AI_SHARED_SECRET;
  delete process.env.NETLIFY_AI_FUNCTION_URL;
  delete process.env.ASSISTANT_PROVIDER;
  delete process.env.ASSISTANT_MODEL;
  vi.restoreAllMocks();
});

describe('netlify provider env gate', () => {
  it('throws AssistantProviderError when the shared secret is missing', async () => {
    globalThis.fetch = vi.fn();
    await expect(netlifyProvider.respond(baseArgs())).rejects.toBeInstanceOf(AssistantProviderError);
    await expect(netlifyProvider.respond(baseArgs())).rejects.toMatchObject({ provider: 'netlify' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('resolveProviderName resolves netlify when ASSISTANT_PROVIDER=netlify', () => {
    process.env.ASSISTANT_PROVIDER = 'netlify';
    expect(resolveProviderName()).toBe('netlify');
    process.env.ASSISTANT_PROVIDER = 'bogus';
    expect(resolveProviderName()).toBe('rules');
  });
});

describe('netlify provider requests', () => {
  it('posts to the function URL with the secret header and returns the reply', async () => {
    process.env.NETLIFY_AI_SHARED_SECRET = FAKE_SECRET;
    process.env.NETLIFY_AI_FUNCTION_URL = FAKE_URL;
    globalThis.fetch = vi.fn(async () => jsonResponse(200, completion({ content: 'Hello buyer' })));

    const result = await netlifyProvider.respond(baseArgs());
    expect(result).toEqual({ reply: 'Hello buyer' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(FAKE_URL);
    expect(options.method).toBe('POST');
    expect(options.headers['x-assistant-secret']).toBe(FAKE_SECRET);
    expect(options.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-5-mini');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Where is my order?' });
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_order_status',
          description: 'Get the status of an order',
          parameters: { type: 'object', properties: { orderId: { type: 'string' } } },
        },
      },
    ]);
  });

  it('uses the default production function URL when none is configured', async () => {
    process.env.NETLIFY_AI_SHARED_SECRET = FAKE_SECRET;
    globalThis.fetch = vi.fn(async () => jsonResponse(200, completion({ content: 'Hi' })));
    await netlifyProvider.respond(baseArgs());
    expect(globalThis.fetch.mock.calls[0][0]).toBe(
      'https://haoverseas.netlify.app/.netlify/functions/assistant-ai'
    );
  });

  it('executes a tool call, redacts the tool result outbound, and returns the final reply', async () => {
    process.env.NETLIFY_AI_SHARED_SECRET = FAKE_SECRET;
    process.env.NETLIFY_AI_FUNCTION_URL = FAKE_URL;
    const executeTool = vi.fn(async () => ({
      status: 'Shipped',
      customer: { phoneNumber: '+1-555-0199', email: 'buyer@example.com', name: 'Buyer' },
    }));
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          completion({
            content: '',
            tool_calls: [
              { id: 'call_1', function: { name: 'get_order_status', arguments: '{"orderId":"ord-1"}' } },
            ],
          })
        )
      )
      .mockResolvedValueOnce(jsonResponse(200, completion({ content: 'Your order has shipped.' })));

    const result = await netlifyProvider.respond(baseArgs({ executeTool }));
    expect(result).toEqual({ reply: 'Your order has shipped.' });
    expect(executeTool).toHaveBeenCalledWith('get_order_status', { orderId: 'ord-1' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    const toolMessage = secondBody.messages.find((m) => m.role === 'tool');
    expect(toolMessage).toBeTruthy();
    expect(toolMessage.content).toContain('[REDACTED]');
    expect(toolMessage.content).toContain('Shipped');
    expect(toolMessage.content).not.toContain('+1-555-0199');
    expect(toolMessage.content).not.toContain('buyer@example.com');
  });

  it('throws AssistantProviderError on a non-200 function response', async () => {
    process.env.NETLIFY_AI_SHARED_SECRET = FAKE_SECRET;
    globalThis.fetch = vi.fn(async () => jsonResponse(502, { error: 'upstream_error' }));
    await expect(netlifyProvider.respond(baseArgs())).rejects.toBeInstanceOf(AssistantProviderError);
    await expect(netlifyProvider.respond(baseArgs())).rejects.toMatchObject({ provider: 'netlify' });
  });

  it('wraps network failures in AssistantProviderError', async () => {
    process.env.NETLIFY_AI_SHARED_SECRET = FAKE_SECRET;
    globalThis.fetch = vi.fn(async () => { throw new Error('socket hangup'); });
    await expect(netlifyProvider.respond(baseArgs())).rejects.toBeInstanceOf(AssistantProviderError);
  });
});
