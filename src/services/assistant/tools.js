import mongoose from 'mongoose';
import { Product } from '../../models/Product.js';
import { Order } from '../../models/Order.js';
import { Invoice } from '../../models/Invoice.js';
import { AssistantProposal } from '../../models/AssistantProposal.js';
import { createSearchRegex } from '../../utils/escapeRegExp.js';
import { getTierDiscountPercent } from '../../utils/pricing.js';
import { enqueueEmail } from '../outbox.js';

// Staff roles — same list as STAFF_ROLES in gstController.js /
// authController.js. Holders of these roles get the staff copilot
// tools (staffOnly) in their schema list; everyone else never sees
// them and cannot execute them.
export const STAFF_ROLES = [
  'admin',
  'sales_manager',
  'production_supervisor',
  'qc_inspector',
  'shipping_officer',
  'super_admin',
];

export const isStaffUser = (user) => Boolean(user) && STAFF_ROLES.includes(user.role);

/**
 * Assistant tool registry (FEAT-16, v0.7) — ALLOW-LIST only.
 * Every tool executes AS the requesting user (the service passes the
 * authenticated user in; no tool accepts a userId parameter).
 * Ownership rule: another user's data is NEVER returned — order tools
 * return a refusal result ({error:'not_found_or_not_yours'}) instead.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const compactProduct = (p) => ({
  id: p._id.toString(),
  name: p.name,
  sku: p.sku,
  category: p.category,
  basePrice: p.basePrice,
  currency: p.currency || 'USD',
  moq: p.moq,
});

const findOwnedOrder = async (user, orderId) => {
  if (!orderId) return null;
  const raw = String(orderId).trim();
  let order = null;
  if (mongoose.isValidObjectId(raw)) {
    order = await Order.findById(raw);
  }
  if (!order) {
    // Also accept an order number (case-insensitive, exact).
    order = await Order.findOne({ orderNumber: raw.toUpperCase() });
  }
  if (!order) return null;
  if (order.user.toString() !== user._id.toString()) return null;
  return order;
};

export const refusalResult = () => ({ error: 'not_found_or_not_yours' });

// Staff variant of findOwnedOrder: staff are trusted to act on ANY
// order (the staff copilot), so there is no ownership check — but a
// nonexistent order still resolves to null (-> refusalResult()).
const findAnyOrder = async (orderId) => {
  if (!orderId) return null;
  const raw = String(orderId).trim();
  let order = null;
  if (mongoose.isValidObjectId(raw)) {
    order = await Order.findById(raw);
  }
  if (!order) {
    order = await Order.findOne({ orderNumber: raw.toUpperCase() });
  }
  return order;
};

export const TOOLS = [
  {
    name: 'search_products',
    description: 'Search active products by name, SKU, description or category.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search text' } },
      required: ['query'],
    },
    execute: async (user, args = {}) => {
      const query = String(args.query || '').trim();
      if (!query) return { products: [] };
      const regex = createSearchRegex(query);
      const products = await Product.find({
        isActive: true,
        sku: { $exists: true, $ne: null },
        $or: [{ name: regex }, { sku: regex }, { description: regex }, { category: regex }],
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      return { products: products.map(compactProduct) };
    },
  },
  {
    name: 'get_product',
    description: 'Get compact detail for one active product by id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Product id' } },
      required: ['id'],
    },
    execute: async (user, args = {}) => {
      if (!args.id || !mongoose.isValidObjectId(String(args.id))) return { error: 'not_found' };
      const product = await Product.findById(args.id).lean();
      if (!product || !product.isActive) return { error: 'not_found' };
      return {
        ...compactProduct(product),
        description: product.description || '',
        weightKg: product.weightKg,
        pcsPerCarton: product.pcsPerCarton,
      };
    },
  },
  {
    name: 'estimate_price',
    description:
      'Indicative price estimate for a product and quantity using the buyer distributor tier discount. Never invents prices.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product id' },
        quantity: { type: 'number', description: 'Quantity in pieces' },
      },
      required: ['productId', 'quantity'],
    },
    execute: async (user, args = {}) => {
      if (!args.productId || !mongoose.isValidObjectId(String(args.productId))) {
        return { error: 'not_found' };
      }
      const product = await Product.findById(args.productId).lean();
      if (!product || !product.isActive) return { error: 'not_found' };
      const quantity = Math.max(1, Math.floor(Number(args.quantity) || 1));
      const discount = getTierDiscountPercent(user.distributorTier || 'Standard');
      const unitPrice = round2(product.basePrice * (1 - discount));
      const lineTotal = round2(unitPrice * quantity);
      return {
        product: compactProduct(product),
        quantity,
        tier: user.distributorTier || 'Standard',
        tierDiscountPercent: discount,
        unitPrice,
        lineTotal,
        currency: product.currency || 'USD',
        indicative: true,
      };
    },
  },
  {
    name: 'list_my_orders',
    description: "List the requesting user's own recent orders (max 10, newest first).",
    parameters: { type: 'object', properties: {} },
    execute: async (user) => {
      const orders = await Order.find({ user: user._id }).sort({ createdAt: -1 }).limit(10).lean();
      return {
        orders: orders.map((o) => ({
          id: o._id.toString(),
          orderNumber: o.orderNumber,
          status: o.status,
          totalAmount: o.totalAmount,
          currency: o.currency || 'USD',
          createdAt: o.createdAt,
        })),
      };
    },
  },
  {
    name: 'get_order_status',
    description: "Get status and timeline for one of the requesting user's own orders by id or order number.",
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'Order id or order number' } },
      required: ['orderId'],
    },
    execute: async (user, args = {}) => {
      const order = await findOwnedOrder(user, args.orderId);
      if (!order) return refusalResult();
      return {
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: order.totalAmount,
        currency: order.currency || 'USD',
        createdAt: order.createdAt,
        carrier: order.carrierName || null,
        trackingNumber: order.trackingNumber || null,
        trackingUrl: order.trackingUrl || null,
        timeline: (order.timeline || []).map((t) => ({
          status: t.status,
          at: t.updatedAt,
          ...(t.note ? { note: t.note } : {}),
        })),
      };
    },
  },
  {
    name: 'get_invoice_summary',
    description:
      "Read-only invoice summary for one of the requesting user's own orders. Returns totals exactly as stored.",
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'Order id or order number' } },
      required: ['orderId'],
    },
    execute: async (user, args = {}) => {
      const order = await findOwnedOrder(user, args.orderId);
      if (!order) return refusalResult();
      const invoices = await Invoice.find({ order: order._id }).sort({ createdAt: -1 }).lean();
      return {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        invoices: invoices.map((inv) => ({
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          totalAmount: inv.grandTotal,
          grandTotal: inv.grandTotal,
          amountPaid: inv.amountPaid,
          balanceDue: inv.balanceDue,
          currency: inv.currency || 'USD',
        })),
      };
    },
  },
  {
    name: 'request_human_followup',
    description: 'Ask the H.A. Overseas team for a human follow-up by email.',
    parameters: {
      type: 'object',
      properties: { note: { type: 'string', description: 'What the customer needs help with' } },
      required: [],
    },
    execute: async (user, args = {}) => {
      const supportTo =
        process.env.SUPPORT_EMAIL || process.env.ADMIN_EMAIL || 'admin@haoverseas.com';
      await enqueueEmail({
        to: supportTo,
        template: 'assistantHandoff',
        payload: {
          customerName: user.customerName || '',
          customerEmail: user.email || '',
          email: user.email || '',
          note: String(args.note || ''),
          transcript: String(args.note || ''),
        },
      });
      return { ok: true };
    },
  },
  // ── FEAT-16 Stage 3 (v1.0): proposal tools — NEVER write directly ──
  {
    name: 'create_draft_order',
    description:
      'Propose a draft order for the requesting user. Creates a pending proposal only — NO order is created until the user confirms it.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Line items to propose',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'Product id' },
              quantity: { type: 'number', description: 'Quantity in pieces' },
            },
            required: ['productId', 'quantity'],
          },
        },
      },
      required: ['items'],
    },
    execute: async (user, args = {}) => {
      const items = Array.isArray(args.items) ? args.items : [];
      if (!items.length) return { error: 'items_required' };
      const discount = getTierDiscountPercent(user.distributorTier || 'Standard');
      const lines = [];
      let estimatedTotal = 0;
      let currency = 'USD';
      for (const item of items) {
        if (!item?.productId || !mongoose.isValidObjectId(String(item.productId))) {
          return { error: 'not_found' };
        }
        const product = await Product.findById(item.productId).lean();
        if (!product || !product.isActive) return { error: 'not_found' };
        const quantity = Math.max(1, Math.floor(Number(item.quantity) || 0));
        if (!Number.isFinite(quantity) || quantity < 1) return { error: 'invalid_quantity' };
        const unitPrice = round2(product.basePrice * (1 - discount));
        estimatedTotal = round2(estimatedTotal + round2(unitPrice * quantity));
        currency = product.currency || currency;
        lines.push({ productId: product._id.toString(), quantity, name: product.name });
      }
      const summary =
        `Draft order: ${lines.map((l) => `${l.quantity} × ${l.name}`).join(', ')}` +
        ` — estimated total ${estimatedTotal.toFixed(2)} ${currency} (indicative)`;
      const proposal = await AssistantProposal.create({
        user: user._id,
        kind: 'draft_order',
        summary,
        payload: { items: lines.map(({ productId, quantity }) => ({ productId, quantity })) },
      });
      return {
        proposalId: proposal._id.toString(),
        summary,
        status: 'pending',
        note: 'Awaiting user confirmation — nothing has been ordered yet.',
      };
    },
  },
  {
    name: 'reorder',
    description:
      "Propose reordering one of the requesting user's own past orders. Creates a pending proposal only — NO order is created until the user confirms it.",
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'Order id or order number' } },
      required: ['orderId'],
    },
    execute: async (user, args = {}) => {
      const order = await findOwnedOrder(user, args.orderId);
      if (!order) return refusalResult();
      const summary = `Reorder of order #${order.orderNumber} (${(order.items || []).length} item(s), total ${order.totalAmount} ${order.currency || 'USD'}) as a new draft`;
      const proposal = await AssistantProposal.create({
        user: user._id,
        kind: 'reorder',
        summary,
        payload: { sourceOrderId: order._id.toString() },
      });
      return {
        proposalId: proposal._id.toString(),
        summary,
        status: 'pending',
        note: 'Awaiting user confirmation — nothing has been ordered yet.',
      };
    },
  },
  // ── FEAT-16 Stage 3 (v1.0): staff copilot tools (staffOnly) ───────
  {
    name: 'summarise_order',
    staffOnly: true,
    description: 'Staff copilot: structured summary of ANY order by id or order number.',
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'Order id or order number' } },
      required: ['orderId'],
    },
    execute: async (user, args = {}) => {
      const order = await findAnyOrder(args.orderId);
      if (!order) return refusalResult();
      const timeline = order.timeline || [];
      return {
        orderNumber: order.orderNumber,
        buyer: {
          name: order.customerDetails?.customerName || '',
          company: order.customerDetails?.businessName || '',
        },
        status: order.status,
        items: (order.items || []).length,
        totalAmount: order.totalAmount,
        currency: order.currency || 'USD',
        createdAt: order.createdAt,
        timeline: {
          lastState: timeline.length ? timeline[timeline.length - 1].status : order.status,
        },
      };
    },
  },
  {
    name: 'list_overdue_invoices',
    staffOnly: true,
    description:
      'Staff copilot: READ-ONLY list of overdue invoices (dueDate in the past, not paid/void), worst first, max 20.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const now = new Date();
      const invoices = await Invoice.find({
        dueDate: { $lt: now },
        status: { $nin: ['paid', 'void'] },
      })
        .sort({ dueDate: 1 })
        .limit(20)
        .populate('order', 'orderNumber')
        .lean();
      return {
        invoices: invoices.map((inv) => ({
          invoiceNumber: inv.invoiceNumber,
          orderNumber: inv.order?.orderNumber || null,
          buyerName: inv.customerDetails?.customerName || null,
          totalAmount: inv.grandTotal,
          currency: inv.currency || 'USD',
          dueDate: inv.dueDate,
          daysOverdue: Math.floor((now - new Date(inv.dueDate)) / (24 * 60 * 60 * 1000)),
        })),
      };
    },
  },
  {
    name: 'draft_reply',
    staffOnly: true,
    description:
      'Staff copilot: compose a draft reply text for an order (payment reminder, shipping update or general). TEXT ONLY — sends nothing.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Order id or order number' },
        intent: {
          type: 'string',
          description: "One of 'payment_reminder' | 'shipping_update' | 'general'",
        },
      },
      required: ['orderId'],
    },
    execute: async (user, args = {}) => {
      const order = await findAnyOrder(args.orderId);
      if (!order) return refusalResult();
      const intent = ['payment_reminder', 'shipping_update', 'general'].includes(args.intent)
        ? args.intent
        : 'general';
      const buyerName = order.customerDetails?.customerName || 'Customer';
      let draft;
      if (intent === 'payment_reminder') {
        draft =
          `Dear ${buyerName},\n\nThis is a friendly reminder regarding order #${order.orderNumber} ` +
          `(total ${order.totalAmount} ${order.currency || 'USD'}, current status: ${order.status}). ` +
          `Could you please arrange the outstanding payment at your earliest convenience? ` +
          `If payment has already been sent, please disregard this note and share the reference so we can reconcile it.\n\nThank you,\nH.A. Overseas Export Desk`;
      } else if (intent === 'shipping_update') {
        draft =
          `Dear ${buyerName},\n\nHere is a shipping update for order #${order.orderNumber}: ` +
          `current status is ${order.status}.` +
          (order.trackingNumber
            ? ` Your shipment is with ${order.carrierName || 'the carrier'}, tracking number ${order.trackingNumber}.`
            : ' We will share the carrier and tracking details as soon as your shipment is dispatched.') +
          `\n\nThank you for your patience,\nH.A. Overseas Export Desk`;
      } else {
        draft =
          `Dear ${buyerName},\n\nThank you for your order #${order.orderNumber} ` +
          `(total ${order.totalAmount} ${order.currency || 'USD'}). Its current status is ${order.status}. ` +
          `Please let us know if you need anything else — we are happy to help.\n\nBest regards,\nH.A. Overseas Export Desk`;
      }
      return { draft };
    },
  },
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/**
 * Tool schemas visible to a user. Staff-only tools are included ONLY
 * for staff users. Called with no user, returns the non-staff set so
 * existing callers/tests are unaffected.
 */
export const toolSchemas = (user) => {
  const staff = isStaffUser(user);
  return TOOLS.filter((t) => staff || !t.staffOnly).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
};

export const executeToolByName = async (user, name, args = {}) => {
  const tool = TOOL_MAP[name];
  if (!tool) return { error: 'unknown_tool' };
  if (tool.staffOnly && !isStaffUser(user)) return refusalResult();
  return tool.execute(user, args || {});
};
