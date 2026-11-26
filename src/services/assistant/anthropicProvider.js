import { AssistantProviderError } from './errors.js';
import { redactForProvider } from './redact.js';

/**
 * Anthropic provider (FEAT-16 Stage 3, v1.0)
 * Env-gated: activates only when ASSISTANT_PROVIDER=anthropic AND
 * ANTHROPIC_API_KEY exists. Any failure throws AssistantProviderError
 * so the service falls back to rules. Tool results are redacted
 * before any payload leaves the process (redactForProvider), exactly
 * like the Stage-2 providers. The daily-cap / fallback behaviour
 * lives in assistantService — this module only speaks to Anthropic.
 */
const SYSTEM_PROMPT =
  'You are the H.A. Overseas Order Desk Assistant. Use the provided tools for product, price, order and invoice data. Never invent prices or order data. Prices from estimate_price are indicative. Only discuss the requesting user\'s own data. Write actions are proposals only: tools such as create_draft_order and reorder create a pending proposal that the user must confirm — nothing is ordered until they confirm.';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const anthropicProvider = {
  name: 'anthropic',
  async respond({ messages, executeTool, toolSchemas }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AssistantProviderError('Anthropic API key missing', 'anthropic');
    const model = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5';
    const tools = (toolSchemas || []).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
    const convo = (messages || []).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    }));

    try {
      for (let round = 0; round < 6; round += 1) {
        const payload = redactForProvider({
          model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: convo,
          tools: tools.length ? tools : undefined,
        });
        const res = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new AssistantProviderError(`Anthropic HTTP ${res.status}`, 'anthropic');
        const data = await res.json();
        const blocks = data?.content;
        if (!Array.isArray(blocks)) {
          throw new AssistantProviderError('Malformed Anthropic response', 'anthropic');
        }

        if (data.stop_reason === 'tool_use') {
          const toolUses = blocks.filter((b) => b?.type === 'tool_use');
          if (!toolUses.length) {
            throw new AssistantProviderError('Malformed Anthropic tool_use response', 'anthropic');
          }
          convo.push({ role: 'assistant', content: blocks });
          const toolResults = [];
          for (const block of toolUses) {
            if (!block.name) {
              throw new AssistantProviderError('Malformed Anthropic tool call', 'anthropic');
            }
            const toolResult = await executeTool(block.name, block.input || {});
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(redactForProvider(toolResult)),
            });
          }
          convo.push({ role: 'user', content: toolResults });
          continue;
        }

        const textReply = blocks
          .filter((b) => b?.type === 'text')
          .map((b) => b.text || '')
          .join('')
          .trim();
        if (!textReply) throw new AssistantProviderError('Empty Anthropic response', 'anthropic');
        return { reply: textReply };
      }
      throw new AssistantProviderError('Anthropic tool loop exceeded max rounds', 'anthropic');
    } catch (err) {
      if (err instanceof AssistantProviderError) throw err;
      throw new AssistantProviderError(`Anthropic failure: ${err.message}`, 'anthropic');
    }
  },
};
