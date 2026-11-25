/**
 * Assistant knowledge base (FEAT-16 Stage 1, v0.7)
 * Versioned FAQ entries. FAQ answers are returned verbatim by the
 * rules provider, so wording changes here are product copy changes —
 * bump KNOWLEDGE_VERSION when entries change.
 */
export const KNOWLEDGE_VERSION = '1.0.0';

export const KNOWLEDGE = [
  {
    id: 'lead-time',
    topic: 'Lead time',
    keywords: ['lead time', 'how long', 'production time', 'dispatch time', 'delivery time', 'turnaround'],
    answer:
      'Our standard lead time is 3-4 weeks from order confirmation for regular catalogue items. Custom markings, special finishes or large volumes may take 4-6 weeks. Your confirmed order timeline in My Orders shows the current production stage for your specific order.',
  },
  {
    id: 'packaging',
    topic: 'Packaging',
    keywords: ['packaging', 'packing', 'carton', 'master carton', 'pcs per carton', 'private label', 'labelling', 'labeling'],
    answer:
      'Products are packed in export-grade master cartons, with the pieces-per-carton quantity shown on each product page. Standard packaging is included in the quoted price. Custom branding, laser marking and retail packaging are available on request — please mention your requirements in the order notes.',
  },
  {
    id: 'payment-terms',
    topic: 'Payment terms',
    keywords: ['payment terms', 'payment', 'pay', 'advance', 'tt', 'wire transfer', 'letter of credit', 'lc', 'credit terms'],
    answer:
      'Our standard payment terms are 30% advance by wire transfer (T/T) with the order confirmation and the balance against shipping documents before dispatch. Letter of Credit terms can be discussed for large orders. Invoices show the exact amount paid and balance due for each order.',
  },
  {
    id: 'shipping-logistics',
    topic: 'Shipping & logistics',
    keywords: ['shipping', 'logistics', 'freight', 'delivery', 'shipment', 'incoterm', 'fob', 'cif', 'exw', 'carrier', 'port'],
    answer:
      'We ship worldwide from India on FOB, CIF or EXW terms, as selected on your order. Once your order ships, the carrier name and tracking number appear in My Orders and in your shipping email. Sea freight is standard for bulk orders; air freight can be arranged on request.',
  },
  {
    id: 'minimum-order',
    topic: 'Minimum order',
    keywords: ['minimum order', 'moq', 'minimum quantity', 'smallest order', 'min order'],
    answer:
      'Each product has its own minimum order quantity (MOQ), shown on the product page and in the assistant product results — the standard MOQ for most catalogue items is 50 pieces. Orders below the MOQ cannot be confirmed, but you can combine sizes and finishes of the same product to reach it.',
  },
  {
    id: 'contact',
    topic: 'Contact',
    keywords: ['contact', 'phone', 'email address', 'reach you', 'support', 'help desk', 'talk to'],
    answer:
      'You can reach the H.A. Overseas export desk through the support email shown on our website, or ask this assistant to arrange a human follow-up and our team will get back to you. Please include your order number, if your question is about a specific order, so we can help faster.',
  },
];

export const findKnowledge = (text) => {
  const lower = String(text || '').toLowerCase();
  return KNOWLEDGE.find((entry) => entry.keywords.some((k) => lower.includes(k))) || null;
};
