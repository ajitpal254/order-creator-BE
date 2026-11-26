import mongoose from 'mongoose';
import { AssistantConversation } from '../models/AssistantConversation.js';
import { AssistantProposal, serializeProposal } from '../models/AssistantProposal.js';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import { handleAssistantMessage, AssistantNotFoundError } from '../services/assistant/assistantService.js';
import { KNOWLEDGE, KNOWLEDGE_VERSION } from '../services/assistant/knowledge.js';
import { extractPoLines, matchPoLines } from '../services/assistant/poExtraction.js';
import { enqueueEmail } from '../services/outbox.js';
import { deepCopyItems, saveDraftOrder } from '../utils/draftOrder.js';
import { getTierDiscountPercent, CURRENCY_RATES } from '../utils/pricing.js';
import { logger } from '../utils/logger.js';

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
      proposal: result.proposal || null,
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

// ── FEAT-16 Stage 3/4 (v1.0): proposal confirm / dismiss + PO extract ──

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const loadOwnedProposal = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ success: false, message: 'Proposal not found' });
    return null;
  }
  const proposal = await AssistantProposal.findById(req.params.id);
  if (!proposal || proposal.user.toString() !== req.user._id.toString()) {
    res.status(404).json({ success: false, message: 'Proposal not found' });
    return null;
  }
  return proposal;
};

/**
 * Build a Draft order from catalog items with SERVER-SIDE pricing —
 * the same derivation createOrder performs (Product.basePrice from
 * the catalog, the buyer's current tier discount, currency rate) —
 * persisted via saveDraftOrder (the shared Draft persistence used by
 * reorder/template flows). Proposal-stored prices are NEVER trusted.
 * Throws an error with `status` 422 when a product no longer exists.
 */
const createCatalogDraft = async (user, items, note) => {
  const userTier = user.distributorTier || 'Standard';
  const tierDiscountPercent = getTierDiscountPercent(userTier);
  const currency = 'USD';
  const currencyMultiplier = CURRENCY_RATES[currency] || 1.0;

  let totalQuantity = 0;
  let subtotalAmount = 0;
  let estimatedWeightKg = 0;
  let estimatedCartons = 0;
  const validatedItems = [];

  for (const item of items) {
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 0));
    const prod = item.productId ? await Product.findById(item.productId).catch(() => null) : null;
    if (!prod || !prod.isActive) {
      const err = new Error(`Product no longer available: ${item.name || item.productId || 'unknown'}`);
      err.status = 422;
      throw err;
    }
    const basePriceUsd = prod.basePrice ?? 0;
    const weightKg = prod.weightKg || 1.0;
    const pcsPerCarton = prod.pcsPerCarton || 20;
    const convertedUnitPrice = round2(basePriceUsd * (1 - tierDiscountPercent) * currencyMultiplier);
    const itemTotal = round2(convertedUnitPrice * quantity);
    totalQuantity += quantity;
    subtotalAmount += basePriceUsd * currencyMultiplier * quantity;
    estimatedWeightKg += weightKg * quantity;
    estimatedCartons += Math.ceil(quantity / pcsPerCarton);
    validatedItems.push({
      product: prod._id,
      productName: prod.name,
      sku: prod.sku,
      size: 'Standard',
      finish: 'Standard',
      color: 'Standard',
      brand: 'H.A. Overseas',
      quantity,
      unitPrice: convertedUnitPrice,
      totalPrice: itemTotal,
      packaging: 'Master Carton',
      customMarking: '',
      itemNotes: '',
      snapshot: {
        basePrice: basePriceUsd,
        weightKg,
        pcsPerCarton,
        tierDiscountPercent: tierDiscountPercent * 100,
        finishSurcharge: 0,
        laserMarkingCost: 0,
        packagingCost: 0,
      },
    });
  }

  const totalAmount = round2(validatedItems.reduce((sum, it) => sum + it.totalPrice, 0));
  const discountAmount = round2(Math.max(0, subtotalAmount - totalAmount));

  return saveDraftOrder({
    userId: user._id,
    orderType: 'Order',
    items: validatedItems,
    totals: {
      totalQuantity,
      subtotalAmount: round2(subtotalAmount),
      discountPercent: tierDiscountPercent * 100,
      discountAmount,
      totalAmount,
      estimatedWeightKg: round2(estimatedWeightKg),
      estimatedCartons,
    },
    currency,
    currencyRate: currencyMultiplier,
    incoterm: 'FOB',
    customerDetails: {
      customerName: user.customerName,
      businessName: user.businessName,
      country: user.country,
      phoneNumber: user.phoneNumber,
      address: user.address,
      email: user.email,
    },
    distributorTierSnapshot: userTier,
    updatedBy: user.customerName || user.username,
    note,
  });
};

export const confirmProposal = async (req, res) => {
  try {
    const proposal = await loadOwnedProposal(req, res);
    if (!proposal) return;

    const isExpired =
      proposal.status === 'expired' ||
      (proposal.expiresAt && new Date(proposal.expiresAt) < new Date());
    if (isExpired) {
      if (proposal.status === 'pending') {
        proposal.status = 'expired';
        await proposal.save();
      }
      return res.status(410).json({ success: false, message: 'Proposal has expired' });
    }
    if (proposal.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Proposal is already ${proposal.status}` });
    }

    let order = null;
    if (proposal.kind === 'draft_order') {
      const items = (proposal.payload?.items || []).map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      }));
      if (!items.length) {
        return res.status(422).json({ success: false, message: 'Proposal has no items' });
      }
      order = await createCatalogDraft(req.user, items, 'Draft created from assistant proposal');
    } else if (proposal.kind === 'reorder') {
      const source = await Order.findById(proposal.payload?.sourceOrderId).catch(() => null);
      if (!source) {
        return res.status(404).json({ success: false, message: 'Source order not found' });
      }
      // Same execution as POST /api/orders/:id/reorder (reorderOrder):
      // items/totals copied as stored via saveDraftOrder, and the new
      // Draft belongs to the source order's owner.
      order = await saveDraftOrder({
        userId: source.user,
        orderType: source.orderType,
        items: deepCopyItems(source.items),
        totals: {
          totalQuantity: source.totalQuantity,
          subtotalAmount: source.subtotalAmount,
          discountPercent: source.discountPercent,
          discountAmount: source.discountAmount,
          totalAmount: source.totalAmount,
          estimatedWeightKg: source.estimatedWeightKg,
          estimatedCartons: source.estimatedCartons,
        },
        currency: source.currency,
        currencyRate: source.currencyRate,
        incoterm: source.incoterm,
        customerDetails: source.customerDetails
          ? {
              customerName: source.customerDetails.customerName,
              businessName: source.customerDetails.businessName,
              country: source.customerDetails.country,
              phoneNumber: source.customerDetails.phoneNumber,
              address: source.customerDetails.address,
              email: source.customerDetails.email,
            }
          : undefined,
        distributorTierSnapshot: source.distributorTierSnapshot,
        updatedBy: req.user.customerName || req.user.username,
        note: `Reordered from order #${source.orderNumber} via assistant proposal — draft saved`,
      });
    } else if (proposal.kind === 'po_draft') {
      const lines = proposal.payload?.lines || [];
      const unmatched = lines.filter((l) => !l.productId);
      if (unmatched.length) {
        return res.status(422).json({
          success: false,
          message: 'Some PO lines could not be matched to the catalog. Nothing was created.',
          unmatched,
        });
      }
      if (!lines.length) {
        return res.status(422).json({ success: false, message: 'Proposal has no lines' });
      }
      order = await createCatalogDraft(
        req.user,
        lines.map((l) => ({ productId: l.productId, quantity: l.quantity, name: l.name })),
        'Draft created from purchase-order proposal'
      );
    } else {
      return res.status(422).json({ success: false, message: `Unknown proposal kind: ${proposal.kind}` });
    }

    proposal.status = 'confirmed';
    proposal.createdOrder = order._id;
    await proposal.save();

    return res.status(201).json({ success: true, order, proposal: serializeProposal(proposal) });
  } catch (err) {
    if (err.status === 422) {
      return res.status(422).json({ success: false, message: err.message });
    }
    logger.error('Error confirming assistant proposal', { error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const dismissProposal = async (req, res) => {
  try {
    const proposal = await loadOwnedProposal(req, res);
    if (!proposal) return;
    if (proposal.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Proposal is already ${proposal.status}` });
    }
    proposal.status = 'dismissed';
    await proposal.save();
    return res.status(200).json({ success: true, proposal: serializeProposal(proposal) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const extractPo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'A PO file is required (field: file)' });
    }
    const rawLines = await extractPoLines({
      buffer: req.file.buffer,
      filename: req.file.originalname || '',
      mimetype: req.file.mimetype || '',
    });
    const lines = await matchPoLines(rawLines);
    const matchedCount = lines.filter((l) => l.matched).length;
    const summary =
      `PO draft from ${req.file.originalname || 'uploaded file'}: ${lines.length} line(s), ` +
      `${matchedCount} matched to the catalog`;
    const proposal = await AssistantProposal.create({
      user: req.user._id,
      kind: 'po_draft',
      summary,
      payload: {
        lines: lines.map(({ name, quantity, unitPrice, productId }) => ({
          name,
          quantity,
          unitPrice,
          productId,
        })),
        sourceFileName: req.file.originalname || '',
      },
    });
    return res.status(201).json({
      success: true,
      proposal: serializeProposal(proposal),
      lines: lines.map(({ name, quantity, unitPrice, productId, matched }) => ({
        name,
        quantity,
        unitPrice,
        productId,
        matched,
      })),
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, message: err.message });
    }
    logger.error('Error extracting PO', { error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
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
