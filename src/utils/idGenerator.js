import { Counter } from '../models/Counter.js';

/**
 * ID generation (SEC-12) — counter-backed, format-preserving.
 *
 * Formats are UNCHANGED from the previous random generation:
 *   Order:   "HAO-<year>-<6 digits>"   e.g. HAO-2026-100000
 *   Quote:   "RFQ-<year>-<6 digits>"   e.g. RFQ-2026-100001
 *   Payment: "PAY-<epoch ms>-<3+ digits>" e.g. PAY-1764115200000-001
 *
 * Before: the trailing segment was a random number in [100000, 999999]
 * for orders (collisions possible, uniqueness relied on luck + the
 * unique index) and [100, 999] for payments.
 * After: the trailing segment is 99999 + the atomic counter value for
 * orders, so the first IDs are 100000, 100001, 100002, … — the same
 * 6-digit shape, now guaranteed sequential and collision-free per
 * (prefix, year). If a sequence ever passes 900000 values in one year
 * the segment simply grows a digit rather than wrapping/colliding.
 */

export const generateOrderNumber = async (orderType = 'Order') => {
  const prefix = orderType === 'Quote' ? 'RFQ' : 'HAO';
  const year = new Date().getFullYear();
  const seq = await Counter.nextSequence(`order:${prefix}:${year}`);
  return `${prefix}-${year}-${99999 + seq}`;
};

/**
 * Payment IDs for invoice payments.
 *
 * NOTE (blocker, see v0.2 report): this helper is NOT yet wired into
 * payment recording. The live paymentId is produced by a synchronous
 * schema default inside src/models/Invoice.js
 * (`PAY-${Date.now()}-${random 100-999}`), and a Mongoose default
 * cannot await the async counter. Wiring this in requires setting
 * `paymentId` explicitly in invoiceController.recordPayment before
 * `invoice.payments.push(...)` — a change inside invoice logic, which
 * is off-limits for this release. The helper is ready for that
 * one-line swap: its output keeps the exact `PAY-<epoch ms>-<digits>`
 * shape, with the trailing segment zero-padded to 3 digits.
 */
export const generatePaymentId = async () => {
  const seq = await Counter.nextSequence('payment');
  return `PAY-${Date.now()}-${String(seq).padStart(3, '0')}`;
};
