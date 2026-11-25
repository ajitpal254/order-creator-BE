import { findKnowledge } from './knowledge.js';

/**
 * Rules provider (FEAT-16 Stage 1, v0.7) — DEFAULT provider.
 * Pure intent/keyword matching over the allow-listed tools.
 * Makes ZERO external calls (no fetch anywhere in this module).
 */

export const DEFAULT_CHIPS = [
  'Track my order',
  'Find a product',
  'Get a price estimate',
  'Show my orders',
  'Talk to a human',
];

const FALLBACK_REPLY =
  "Sorry, I didn't quite understand that. I'm the H.A. Overseas Order Desk Assistant and I can help you track an order, find a product, give an indicative price estimate, show your recent orders, summarise an invoice, or answer questions about lead time, packaging, payment terms, shipping and minimum order quantities. You can also ask me to arrange a human follow-up.";

const ORDER_NUMBER_RE = /\bHAO-\d{4}-\d+\b/i;
const OBJECT_ID_RE = /\b[0-9a-fA-F]{24}\b/;

const extractOrderRef = (text) => {
  const num = text.match(ORDER_NUMBER_RE);
  if (num) return num[0].toUpperCase();
  const oid = text.match(OBJECT_ID_RE);
  if (oid) return oid[0];
  return null;
};

const extractQuantity = (text) => {
  // Prefer "for 100", "100 pcs/units", "quantity 100", "x100"
  const patterns = [
    /(?:quantity|qty)\s*(?:of|:)?\s*(\d+)/i,
    /(?:for|x)\s*(\d+)\b/i,
    /(\d+)\s*(?:pcs|pieces|units|nos|numbers)\b/i,
    /\b(\d+)\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
};

const STOP_WORDS = new Set([
  'what', 'is', 'the', 'price', 'cost', 'for', 'of', 'a', 'an', 'me', 'please',
  'estimate', 'estimated', 'pricing', 'how', 'much', 'does', 'do', 'you', 'have',
  'find', 'search', 'show', 'get', 'give', 'tell', 'i', 'want', 'need', 'looking',
  'look', 'product', 'products', 'quote', 'quotation', 'pcs', 'pieces', 'units',
  'quantity', 'qty', 'x',
]);

const searchTermFrom = (text) => {
  const words = text
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()) && !/^\d+$/.test(w));
  return words.join(' ').trim();
};

const formatMoney = (amount, currency = 'USD') => {
  const n = Number(amount);
  return Number.isFinite(n) ? `${n.toFixed(2)} ${currency}` : `${amount} ${currency}`;
};

const formatOrderLine = (o) =>
  `#${o.orderNumber} — status: ${o.status}, total: ${formatMoney(o.totalAmount, o.currency)}, placed ${o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : ''}`;

export const rulesProvider = {
  name: 'rules',
  async respond({ messages, executeTool }) {
    const history = Array.isArray(messages) ? messages : [];
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    const text = String(lastUser?.content || '').trim();
    const chips = [...DEFAULT_CHIPS];

    if (!text) return { reply: FALLBACK_REPLY, chips };

    // ── Human handoff ──────────────────────────────────────────────
    if (
      /\b(human|agent|representative|real person|someone from your team)\b/i.test(text) ||
      /talk to (a )?(human|person|someone)/i.test(text) ||
      /human follow.?up/i.test(text) ||
      /\b(call me|contact me)\b/i.test(text)
    ) {
      await executeTool('request_human_followup', { note: text });
      return {
        reply:
          "Of course — I've arranged a human follow-up for you. A member of the H.A. Overseas team will get back to you by email. Is there anything else I can help with in the meantime?",
        chips,
      };
    }

    // ── Invoice questions ──────────────────────────────────────────
    if (/\b(invoice|billing|balance due|amount paid)\b/i.test(text)) {
      const ref = extractOrderRef(text);
      if (ref) {
        const result = await executeTool('get_invoice_summary', { orderId: ref });
        if (result?.error) {
          return {
            reply:
              "I couldn't find an order matching that reference in your account, so I can't show its invoice. Please check the order number, or ask me to show your recent orders.",
            chips,
          };
        }
        if (!result.invoices?.length) {
          return {
            reply: `Order #${result.orderNumber} doesn't have an invoice yet. Invoices are issued by our export desk once your order is confirmed.`,
            chips,
          };
        }
        const lines = result.invoices.map(
          (inv) =>
            `Invoice ${inv.invoiceNumber} — status: ${inv.status}, total: ${formatMoney(inv.totalAmount, inv.currency)}, amount paid: ${formatMoney(inv.amountPaid, inv.currency)}, balance due: ${formatMoney(inv.balanceDue, inv.currency)}`
        );
        return { reply: `Here is the invoice summary for order #${result.orderNumber}:\n${lines.join('\n')}`, chips };
      }
      const mine = await executeTool('list_my_orders', {});
      if (mine?.orders?.length) {
        return {
          reply: `Which order would you like the invoice summary for? Your recent orders are:\n${mine.orders.map(formatOrderLine).join('\n')}\nPlease reply with the order number.`,
          chips,
        };
      }
      return { reply: "I couldn't find any orders on your account yet, so there are no invoices to summarise.", chips };
    }

    // ── Track / order status ───────────────────────────────────────
    const hasOrderRef = Boolean(extractOrderRef(text));
    if (
      /where is my order/i.test(text) ||
      /\btrack(ing)?\b/i.test(text) ||
      /order status/i.test(text) ||
      /status of (my )?order/i.test(text) ||
      hasOrderRef
    ) {
      const ref = extractOrderRef(text);
      if (ref) {
        const result = await executeTool('get_order_status', { orderId: ref });
        if (result?.error) {
          return {
            reply:
              "I couldn't find an order matching that reference in your account. Please check the order number — I can only show orders placed from your own account.",
            chips,
          };
        }
        let reply = `Order #${result.orderNumber} — current status: ${result.status}. Total: ${formatMoney(result.totalAmount, result.currency)}.`;
        if (result.trackingNumber) {
          reply += ` Carrier: ${result.carrier || '—'}, tracking number: ${result.trackingNumber}.`;
        }
        if (result.timeline?.length) {
          reply += `\nTimeline: ${result.timeline.map((t) => t.status).join(' → ')}`;
        }
        return { reply, chips };
      }
      const mine = await executeTool('list_my_orders', {});
      if (!mine?.orders?.length) {
        return { reply: "I couldn't find any orders on your account yet. Once you place an order, I can track it for you here.", chips };
      }
      if (mine.orders.length === 1) {
        const o = mine.orders[0];
        return { reply: `Your order ${formatOrderLine(o)}.`, chips };
      }
      return {
        reply: `Here are your recent orders:\n${mine.orders.map(formatOrderLine).join('\n')}\nReply with an order number and I'll give you its full status and timeline.`,
        chips,
      };
    }

    // ── List my orders ─────────────────────────────────────────────
    if (/\b(my orders|list.*orders|show.*orders|recent orders|order history)\b/i.test(text)) {
      const mine = await executeTool('list_my_orders', {});
      if (!mine?.orders?.length) {
        return { reply: "You don't have any orders yet. I can help you find a product and get an indicative price estimate to get started.", chips };
      }
      return { reply: `Here are your recent orders:\n${mine.orders.map(formatOrderLine).join('\n')}`, chips };
    }

    // ── FAQ (knowledge base, verbatim) ─────────────────────────────
    const faq = findKnowledge(text);
    if (faq) {
      return { reply: faq.answer, chips };
    }

    // ── Price estimate ─────────────────────────────────────────────
    if (/\b(price|pricing|cost|estimate|quote|how much)\b/i.test(text)) {
      const oid = text.match(OBJECT_ID_RE)?.[0];
      const quantity = extractQuantity(text);
      let productId = null;
      let productName = null;

      if (oid) {
        // Could be a product id — try it directly when quantity known.
        productId = oid;
      } else {
        // Resolve from conversation history: last search/product mention.
        const term = searchTermFrom(text);
        if (term) {
          const found = await executeTool('search_products', { query: term });
          if (found?.products?.length) {
            productId = found.products[0].id;
            productName = found.products[0].name;
          }
        }
        if (!productId) {
          // Fall back to a product mentioned earlier in the conversation.
          for (const m of [...history].reverse()) {
            const prevOid = String(m.content || '').match(OBJECT_ID_RE)?.[0];
            if (prevOid && prevOid !== oid) { productId = prevOid; break; }
          }
        }
      }

      if (!productId) {
        return {
          reply:
            "I can give you an indicative price estimate — which product would you like priced? Please tell me the product name or SKU, and the quantity you need.",
          chips,
        };
      }
      if (!quantity) {
        return {
          reply: `How many pieces would you like the indicative estimate for${productName ? ` (${productName})` : ''}? Please reply with a quantity.`,
          chips,
        };
      }
      const est = await executeTool('estimate_price', { productId, quantity });
      if (est?.error) {
        return {
          reply:
            "I couldn't find that product in our active catalogue, so I can't estimate a price for it. Please check the product name or SKU.",
          chips,
        };
      }
      return {
        reply:
          `Indicative estimate for ${est.product.name} (${est.product.sku}): unit price ${formatMoney(est.unitPrice, est.currency)}` +
          (est.tierDiscountPercent ? ` (includes your ${est.tier} tier discount of ${Math.round(est.tierDiscountPercent * 100)}%)` : '') +
          ` × ${est.quantity} = line total ${formatMoney(est.lineTotal, est.currency)}. This is indicative only — your formal quote from our export desk confirms the final price.`,
        chips,
      };
    }

    // ── Find / search products ─────────────────────────────────────
    const term = searchTermFrom(text) || text;
    const found = await executeTool('search_products', { query: term });
    if (found?.products?.length) {
      const lines = found.products.map(
        (p) => `${p.name} (${p.sku}) — ${p.category}, base price ${formatMoney(p.basePrice, p.currency)}, MOQ ${p.moq}`
      );
      return { reply: `Here is what I found:\n${lines.join('\n')}\nAsk me for an indicative price estimate for any of these with a quantity.`, chips };
    }

    // ── Graceful fallback ──────────────────────────────────────────
    return { reply: FALLBACK_REPLY, chips };
  },
};
