import { AssistantProviderError } from './errors.js';
import { redactForProvider } from './redact.js';

/**
 * Gemini provider (FEAT-16 Stage 2, v0.7)
 * Env-gated: activates only when ASSISTANT_PROVIDER=gemini AND
 * GEMINI_API_KEY exists. Any failure throws AssistantProviderError
 * so the service falls back to rules. Tool results are redacted
 * before any payload leaves the process.
 */
const SYSTEM_PROMPT =
  'You are the H.A. Overseas Order Desk Assistant. Use the provided functions for product, price, order and invoice data. Never invent prices or order data. Prices from estimate_price are indicative. Only discuss the requesting user\'s own data.';

export const geminiProvider = {
  name: 'gemini',
  async respond({ messages, executeTool, toolSchemas }) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new AssistantProviderError('Gemini API key missing', 'gemini');
    const model = process.env.ASSISTANT_MODEL || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const functionDeclarations = (toolSchemas || []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    const contents = (messages || []).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }],
    }));

    try {
      for (let round = 0; round < 6; round += 1) {
        const payload = redactForProvider({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
        });
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new AssistantProviderError(`Gemini HTTP ${res.status}`, 'gemini');
        const data = await res.json();
        const candidate = data?.candidates?.[0];
        const parts = candidate?.content?.parts;
        if (!Array.isArray(parts)) throw new AssistantProviderError('Malformed Gemini response', 'gemini');
        const functionCalls = parts.filter((p) => p?.functionCall);
        if (functionCalls.length) {
          contents.push({ role: 'model', parts });
          const responseParts = [];
          for (const part of functionCalls) {
            const { name, args } = part.functionCall;
            if (!name) throw new AssistantProviderError('Malformed Gemini function call', 'gemini');
            const toolResult = await executeTool(name, args || {});
            responseParts.push({
              functionResponse: { name, response: { result: redactForProvider(toolResult) } },
            });
          }
          contents.push({ role: 'user', parts: responseParts });
          continue;
        }
        const textReply = parts.map((p) => p?.text || '').join('').trim();
        if (!textReply) throw new AssistantProviderError('Empty Gemini response', 'gemini');
        return { reply: textReply };
      }
      throw new AssistantProviderError('Gemini tool loop exceeded max rounds', 'gemini');
    } catch (err) {
      if (err instanceof AssistantProviderError) throw err;
      throw new AssistantProviderError(`Gemini failure: ${err.message}`, 'gemini');
    }
  },
};
