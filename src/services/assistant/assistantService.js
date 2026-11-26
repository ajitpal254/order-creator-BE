import { AssistantConversation } from '../../models/AssistantConversation.js';
import { executeToolByName, toolSchemas } from './tools.js';
import { rulesProvider } from './rulesProvider.js';
import { cloudflareProvider } from './cloudflareProvider.js';
import { geminiProvider } from './geminiProvider.js';
import { logger } from '../../utils/logger.js';

/**
 * Assistant service (FEAT-16, v0.7)
 *
 * Env vars (see .env.example):
 *   ASSISTANT_PROVIDER   'rules' (default) | 'cloudflare' | 'gemini'.
 *                        Unset/unknown => rules, ZERO external calls.
 *   ASSISTANT_MODEL      Model id for the Stage-2 provider.
 *   ASSISTANT_DAILY_CAP  Max user messages per user per day before the
 *                        rules provider takes over (default 50).
 *                        Read per-request, never cached at import.
 *   CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN  Cloudflare gate.
 *   GEMINI_API_KEY       Gemini gate.
 *   SUPPORT_EMAIL        Handoff recipient (falls back to ADMIN_EMAIL).
 *
 * Every exchange is persisted to AssistantConversation. Every tool
 * executes AS the requesting user. Any Stage-2 failure falls back
 * to the rules provider.
 */

const PROVIDERS = { rules: rulesProvider, cloudflare: cloudflareProvider, gemini: geminiProvider };

export const resolveProviderName = () => {
  const raw = String(process.env.ASSISTANT_PROVIDER || 'rules').toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(PROVIDERS, raw) ? raw : 'rules';
};

export const getDailyCap = () => {
  const parsed = parseInt(process.env.ASSISTANT_DAILY_CAP, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
};

export const countTodayUserMessages = async (userId) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const convos = await AssistantConversation.find({ user: userId }).select('messages').lean();
  let count = 0;
  for (const convo of convos) {
    for (const msg of convo.messages || []) {
      if (msg.role === 'user' && (!msg.at || new Date(msg.at) >= start)) count += 1;
    }
  }
  return count;
};

export class AssistantNotFoundError extends Error {
  constructor(message = 'Conversation not found') {
    super(message);
    this.name = 'AssistantNotFoundError';
    this.status = 404;
  }
}

export const handleAssistantMessage = async ({ user, message, conversationId }) => {
  let conversation = null;
  if (conversationId) {
    if (!conversationId.match(/^[0-9a-fA-F]{24}$/)) throw new AssistantNotFoundError();
    conversation = await AssistantConversation.findById(conversationId);
    if (!conversation || conversation.user.toString() !== user._id.toString()) {
      throw new AssistantNotFoundError();
    }
  }
  if (!conversation) {
    conversation = new AssistantConversation({ user: user._id, messages: [], toolCalls: [], provider: 'rules' });
  }

  const requested = resolveProviderName();
  let providerName = requested;
  let capHit = false;
  if (requested !== 'rules') {
    const usedToday = await countTodayUserMessages(user._id);
    if (usedToday >= getDailyCap()) {
      capHit = true;
      providerName = 'rules';
    }
  }

  const toolCallsMade = [];
  const executeTool = async (name, args = {}) => {
    toolCallsMade.push({ name, at: new Date() });
    return executeToolByName(user, name, args);
  };

  const history = [
    ...(conversation.messages || []).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];
  const schemas = toolSchemas();

  let result;
  let usedProvider = providerName;
  if (providerName === 'rules') {
    result = await rulesProvider.respond({ messages: history, user, toolSchemas: schemas, executeTool });
  } else {
    try {
      result = await PROVIDERS[providerName].respond({ messages: history, user, toolSchemas: schemas, executeTool });
    } catch (err) {
      logger.warn('Assistant: Stage-2 provider failed, falling back to rules', {
        provider: providerName,
        error: err.message,
      });
      usedProvider = 'rules';
      result = await rulesProvider.respond({ messages: history, user, toolSchemas: schemas, executeTool });
    }
  }

  let reply = String(result?.reply || '');
  if (capHit) {
    reply +=
      '\n\nNote: You have reached the daily assistant limit for the AI assistant, so I answered with the built-in assistant instead. The limit resets tomorrow.';
  }

  const now = new Date();
  conversation.messages.push({ role: 'user', content: message, at: now });
  conversation.messages.push({ role: 'assistant', content: reply, at: new Date() });
  conversation.toolCalls.push(...toolCallsMade);
  conversation.provider = usedProvider;
  await conversation.save();

  return {
    conversation,
    conversationId: conversation._id.toString(),
    reply,
    chips: result?.chips || [],
    provider: usedProvider,
  };
};
