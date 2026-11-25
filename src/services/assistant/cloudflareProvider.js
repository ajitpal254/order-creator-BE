import { AssistantProviderError } from './errors.js';
import { redactForProvider } from './redact.js';

/**
 * Cloudflare Workers AI provider (FEAT-16 Stage 2, v0.7)
 * Env-gated: activates only when ASSISTANT_PROVIDER=cloudflare AND
 * CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN exist. Any failure
 * throws AssistantProviderError so the service falls back to rules.
 * Tool results are redacted before any payload leaves the process.
 */
const SYSTEM_PROMPT =
  'You are the H.A. Overseas Order Desk Assistant. Use the provided tools for product, price, order and invoice data. Never invent prices or order data. Prices from estimate_price are indicative. Only discuss the requesting user\'s own data.';

export const cloudflareProvider = {
  name: 'cloudflare',
  async respond({ messages, executeTool, toolSchemas }) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !token) {
      throw new AssistantProviderError('Cloudflare credentials missing', 'cloudflare');
    }
    const model = process.env.ASSISTANT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
    const tools = (toolSchemas || []).map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const convo = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
    ];

    try {
      for (let round = 0; round < 6; round += 1) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(redactForProvider({ messages: convo, tools })),
        });
        if (!res.ok) throw new AssistantProviderError(`Cloudflare HTTP ${res.status}`, 'cloudflare');
        const data = await res.json();
        const result = data?.result ?? data;
        const message =
          result?.choices?.[0]?.message || result?.message || (typeof result === 'object' ? result : null);
        const toolCalls = message?.tool_calls || result?.tool_calls || [];
        if (Array.isArray(toolCalls) && toolCalls.length) {
          convo.push({ role: 'assistant', content: message?.content || '', tool_calls: toolCalls });
          for (const call of toolCalls) {
            const name = call?.function?.name || call?.name;
            let args = call?.function?.arguments ?? call?.arguments ?? {};
            if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
            if (!name) throw new AssistantProviderError('Malformed tool call from Cloudflare', 'cloudflare');
            const toolResult = await executeTool(name, args || {});
            convo.push({
              role: 'tool',
              tool_call_id: call?.id || name,
              name,
              content: JSON.stringify(redactForProvider(toolResult)),
            });
          }
          continue;
        }
        const textReply =
          (typeof message?.content === 'string' && message.content) ||
          (typeof result?.response === 'string' && result.response) ||
          (typeof result?.text === 'string' && result.text) ||
          '';
        if (!textReply) throw new AssistantProviderError('Malformed Cloudflare response', 'cloudflare');
        return { reply: textReply };
      }
      throw new AssistantProviderError('Cloudflare tool loop exceeded max rounds', 'cloudflare');
    } catch (err) {
      if (err instanceof AssistantProviderError) throw err;
      throw new AssistantProviderError(`Cloudflare failure: ${err.message}`, 'cloudflare');
    }
  },
};
