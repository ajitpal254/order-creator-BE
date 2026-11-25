import { AssistantConversation } from '../models/AssistantConversation.js';
import { handleAssistantMessage, AssistantNotFoundError } from '../services/assistant/assistantService.js';
import { KNOWLEDGE, KNOWLEDGE_VERSION } from '../services/assistant/knowledge.js';
import { enqueueEmail } from '../services/outbox.js';

/**
 * Assistant controllers (FEAT-16, v0.7) — mounted at /api/assistant.
 * All handlers run behind `protect`; conversations are own-only
 * (another user's conversation is a 404, per SEC-01 pattern).
 */

export const postMessage = async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ success: false, message: 'message is required' });
    const result = await handleAssistantMessage({
      user: req.user,
      message,
      conversationId: req.body?.conversationId || undefined,
    });
    return res.status(200).json({
      success: true,
      conversationId: result.conversationId,
      reply: result.reply,
      chips: result.chips || [],
    });
  } catch (err) {
    if (err instanceof AssistantNotFoundError || err.status === 404) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

const transcriptToText = (transcript, conversation) => {
  if (typeof transcript === 'string' && transcript.trim()) return transcript;
  if (Array.isArray(transcript) && transcript.length) {
    return transcript
      .map((m) => (typeof m === 'string' ? m : `${m.role || 'user'}: ${m.content || ''}`))
      .join('\n');
  }
  if (conversation?.messages?.length) {
    return conversation.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
  }
  return typeof transcript === 'string' ? transcript : '';
};

export const postHandoff = async (req, res) => {
  try {
    let conversation = null;
    const { conversationId, transcript, note } = req.body || {};
    if (conversationId) {
      conversation = await AssistantConversation.findById(conversationId);
      if (!conversation || conversation.user.toString() !== req.user._id.toString()) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
      }
    }
    const supportTo =
      process.env.SUPPORT_EMAIL || process.env.ADMIN_EMAIL || 'admin@haoverseas.com';
    await enqueueEmail({
      to: supportTo,
      template: 'assistantHandoff',
      payload: {
        customerName: req.user.customerName || '',
        customerEmail: req.user.email || '',
        email: req.user.email || '',
        note: note ? String(note) : '',
        transcript: transcriptToText(transcript, conversation),
        conversationId: conversationId ? String(conversationId) : '',
      },
    });
    return res.status(200).json({ success: true, ok: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const postFeedback = async (req, res) => {
  try {
    const { conversationId, messageIndex, rating } = req.body || {};
    if (!conversationId) return res.status(400).json({ success: false, message: 'conversationId is required' });
    if (!['up', 'down'].includes(rating)) {
      return res.status(400).json({ success: false, message: "rating must be 'up' or 'down'" });
    }
    const conversation = await AssistantConversation.findById(conversationId);
    if (!conversation || conversation.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    conversation.feedback.push({
      rating,
      messageIndex: typeof messageIndex === 'number' ? messageIndex : null,
      at: new Date(),
    });
    await conversation.save();
    return res.status(200).json({ success: true, ok: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getFaq = async (req, res) => {
  return res.status(200).json({ success: true, version: KNOWLEDGE_VERSION, data: KNOWLEDGE });
};

export const deleteConversation = async (req, res) => {
  try {
    const conversation = await AssistantConversation.findById(req.params.id);
    if (!conversation || conversation.user.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    await conversation.deleteOne();
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
