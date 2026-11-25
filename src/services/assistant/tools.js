import mongoose from 'mongoose';
import { Product } from '../../models/Product.js';
import { Order } from '../../models/Order.js';
import { Invoice } from '../../models/Invoice.js';
import { createSearchRegex } from '../../utils/escapeRegExp.js';
import { getTierDiscountPercent } from '../../utils/pricing.js';
import { enqueueEmail } from '../outbox.js';

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
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

export const toolSchemas = () =>
  TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

export const executeToolByName = async (user, name, args = {}) => {
  const tool = TOOL_MAP[name];
  if (!tool) return { error: 'unknown_tool' };
  return tool.execute(user, args || {});
};
