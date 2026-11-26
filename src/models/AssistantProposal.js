import mongoose from 'mongoose';

/**
 * AssistantProposal (FEAT-16 Stages 3+4, v1.0)
 *
 * A write action PROPOSED by the assistant (or by PO extraction) that
 * has NOT been executed yet. Write tools never write directly: they
 * create one of these, the user confirms via
 * POST /api/assistant/proposals/:id/confirm, and only then is a real
 * Draft order created through the normal order-creation path.
 *
 * Lifecycle: pending -> confirmed | dismissed | expired.
 * Proposals expire 15 minutes after creation (expiresAt); confirming
 * an expired proposal is a 410.
 */
const assistantProposalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['draft_order', 'reorder', 'po_draft'],
      required: true,
    },
    summary: {
      type: String,
      default: '',
    },
    // Kind-specific data:
    //   draft_order: { items: [{ productId, quantity }] }
    //   reorder:     { sourceOrderId }
    //   po_draft:    { lines: [{ productId|null, name, quantity, unitPrice|null }], sourceFileName }
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'dismissed', 'expired'],
      default: 'pending',
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 15 * 60 * 1000),
    },
    createdOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
  },
  { timestamps: true }
);

export const AssistantProposal = mongoose.model('AssistantProposal', assistantProposalSchema);

export const serializeProposal = (proposal) => ({
  id: proposal._id.toString(),
  kind: proposal.kind,
  summary: proposal.summary,
  status: proposal.status,
  expiresAt: proposal.expiresAt,
  payload: proposal.payload || {},
  createdOrder: proposal.createdOrder ? proposal.createdOrder.toString() : null,
  createdAt: proposal.createdAt,
});

export const serializeProposalBrief = (proposal) => ({
  id: proposal._id.toString(),
  kind: proposal.kind,
  summary: proposal.summary,
  status: proposal.status,
  expiresAt: proposal.expiresAt,
});
