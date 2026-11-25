import mongoose from 'mongoose';

/**
 * AssistantConversation (FEAT-16, v0.7)
 * One AI Order Desk Assistant conversation belonging to a single user.
 * Messages/tool calls/feedback are append-only arrays. Conversations
 * expire 30 days after last update via TTL index on updatedAt.
 */
const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, default: '' },
  at: { type: Date, default: Date.now },
}, { _id: false });

const toolCallSchema = new mongoose.Schema({
  name: { type: String, required: true },
  at: { type: Date, default: Date.now },
}, { _id: false });

const feedbackSchema = new mongoose.Schema({
  rating: { type: String, enum: ['up', 'down'], required: true },
  messageIndex: { type: Number, default: null },
  at: { type: Date, default: Date.now },
}, { _id: false });

const assistantConversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    messages: { type: [messageSchema], default: [] },
    toolCalls: { type: [toolCallSchema], default: [] },
    feedback: { type: [feedbackSchema], default: [] },
    provider: { type: String, default: 'rules' },
  },
  { timestamps: true }
);

// TTL: expire 30 days after last activity.
assistantConversationSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const AssistantConversation = mongoose.model('AssistantConversation', assistantConversationSchema);
