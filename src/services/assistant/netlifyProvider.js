import { AssistantProviderError } from './errors.js';
import { redactForProvider } from './redact.js';

/**
 * Netlify AI Gateway provider (FEAT-16 Stage 2, v0.8)
 * Env-gated: activates only when ASSISTANT_PROVIDER=netlify AND
 * NETLIFY_AI_SHARED_SECRET exists. Inference runs in the Netlify
 * Function shipped with the frontend (netlify/functions/assistant-ai),
 * which calls the model through Netlify's AI Gateway — this backend
 * never holds a model-provider key. The shared secret authenticates
 * backend -> function so the function is never an open proxy.
 * Any failure throws AssistantProviderError so the service falls
 * back to rules. Tool results are redacted before any payload
 * leaves the process.
 */
const SYSTEM_PROMPT =
  'You are the H.A. Overseas Order Desk Assistant. Use the provided tools for product, price, order and invoice data. Never invent prices or order data. Prices from estimate_price are indicative. Only discuss the requesting user\'s own data.';

const DEFAULT_FUNCTION_URL = 'https://haoverseas.netlify.app/.netlify/functions/assistant-ai';

export const netlifyProvider = {
  name: 'netlify',
  async respond({ messages, executeTool, toolSchemas }) {
    const secret = process.env.NETLIFY_AI_SHARED_SECRET;
    if (!secret) {
      throw new AssistantProviderError('Netlify AI shared secret missing', 'netlify');
    }
    const url = process.env.NETLIFY_AI_FUNCTION_URL || DEFAULT_FUNCTION_URL;
    const model = process.env.ASSISTANT_MODEL || 'gpt-5-mini';
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
          headers: { 'Content-Type': 'application/json', 'x-assistant-secret': secret },
          body: JSON.stringify(redactForProvider({ model, messages: convo, tools })),
        });
        if (!res.ok) throw new AssistantProviderError(`Netlify AI HTTP ${res.status}`, 'netlify');
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
            if (!name) throw new AssistantProviderError('Malformed tool call from Netlify AI', 'netlify');
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
        if (!textReply) throw new AssistantProviderError('Malformed Netlify AI response', 'netlify');
        return { reply: textReply };
      }
      throw new AssistantProviderError('Netlify AI tool loop exceeded max rounds', 'netlify');
    } catch (err) {
      if (err instanceof AssistantProviderError) throw err;
      throw new AssistantProviderError(`Netlify AI failure: ${err.message}`, 'netlify');
    }
  },
};
