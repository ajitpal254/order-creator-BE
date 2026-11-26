/**
 * FEAT-07 (v0.6) — Admin reports (read-only).
 *
 * All endpoints are admin-only (protect + adminOnly on the router).
 * Stored totals are used AS-IS — nothing here recomputes pricing or tax.
 *
 * Real fields used:
 * - Revenue: Order.totalAmount (order-level groups), Order.items[].totalPrice
 *   (product line totals), Order.currency, Order.createdAt.
 *   Country grouping uses the order's destination snapshot
 *   Order.customerDetails.country (the buyer profile also carries
 *   User.country, but the order snapshot is what the order shipped to).
 *   Product grouping keys on the item snapshot: items.product (ObjectId)
 *   when present, else items.productName; label is items.productName.
 * - Receivables ageing: Invoice.balanceDue (outstanding), Invoice.dueDate,
 *   Invoice.currency. Invoice statuses treated as outstanding:
 *   'sent', 'partial', 'overdue' (the model's unpaid / partially-paid
 *   states; 'draft' is unissued, 'paid' is settled, 'void' is dead).
 * - Backlog: Order.status / Order.totalAmount. Open = every status except
 *   Delivered, Closed and Cancelled — Closed and Cancelled are the state
 *   machine's terminal states, and Delivered's only exit is Closed, so a
 *   Delivered order is no longer work-in-progress either.
 */
import { Order } from '../models/Order.js';
import { Invoice } from '../models/Invoice.js';
import { User } from '../models/User.js';
import { ORDER_STATES } from '../utils/stateMachine.js';
import { parsePagination, paginatedResponse } from '../utils/paginate.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── CSV (hand-rolled, RFC-4180 quoting) ─────────────────────────────────────
const csvEscape = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const sendCsv = (res, filename, headers, rows) => {
  const body = [headers.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(body);
};

// ── GET /api/reports/revenue ────────────────────────────────────────────────
const REVENUE_GROUPINGS = ['product', 'buyer', 'country'];

export const getRevenueReport = async (req, res) => {
  try {
    const groupBy = req.query.groupBy || 'buyer';
    if (!REVENUE_GROUPINGS.includes(groupBy)) {
      return res.status(400).json({
        success: false,
        message: `Invalid groupBy "${groupBy}". Must be one of: ${REVENUE_GROUPINGS.join(', ')}`,
      });
    }

    const match = {
      status: { $nin: [ORDER_STATES.DRAFT, ORDER_STATES.CANCELLED] },
    };
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if (from && !Number.isNaN(from.getTime())) {
      match.createdAt = { ...match.createdAt, $gte: from };
    }
    if (to && !Number.isNaN(to.getTime())) {
      match.createdAt = { ...match.createdAt, $lte: to };
    }

    let rows;
    if (groupBy === 'product') {
      const grouped = await Order.aggregate([
        { $match: match },
        { $unwind: '$items' },
        {
          $group: {
            _id: {
              key: { $ifNull: ['$items.product', '$items.productName'] },
              currency: '$currency',
            },
            label: { $first: '$items.productName' },
            orderIds: { $addToSet: '$_id' },
            total: { $sum: '$items.totalPrice' },
          },
        },
        { $sort: { total: -1 } },
      ]);
      rows = grouped.map((g) => ({
        key: String(g._id.key),
        label: g.label || String(g._id.key),
        orders: g.orderIds.length,
        total: round2(g.total),
        currency: g._id.currency,
      }));
    } else if (groupBy === 'country') {
      const grouped = await Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              key: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$customerDetails.country', null] },
                      { $eq: ['$customerDetails.country', ''] },
                    ],
                  },
                  'Unknown',
                  '$customerDetails.country',
                ],
              },
              currency: '$currency',
            },
            orders: { $sum: 1 },
            total: { $sum: '$totalAmount' },
          },
        },
        { $sort: { total: -1 } },
      ]);
      rows = grouped.map((g) => ({
        key: g._id.key,
        label: g._id.key,
        orders: g.orders,
        total: round2(g.total),
        currency: g._id.currency,
      }));
    } else {
      // buyer
      const grouped = await Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: { key: '$user', currency: '$currency' },
            orders: { $sum: 1 },
            total: { $sum: '$totalAmount' },
          },
        },
        { $sort: { total: -1 } },
      ]);
      const buyerIds = [...new Set(grouped.map((g) => String(g._id.key)))];
      const buyers = await User.find({ _id: { $in: buyerIds } })
        .select('customerName email')
        .lean();
      const buyerById = new Map(buyers.map((b) => [String(b._id), b]));
      rows = grouped.map((g) => {
        const buyer = buyerById.get(String(g._id.key));
        return {
          key: String(g._id.key),
          label: buyer ? `${buyer.customerName} (${buyer.email})` : 'Unknown buyer',
          orders: g.orders,
          total: round2(g.total),
          currency: g._id.currency,
        };
      });
    }

    if (req.query.format === 'csv') {
      return sendCsv(
        res,
        'revenue.csv',
        ['key', 'label', 'orders', 'total', 'currency'],
        rows.map((r) => [r.key, r.label, r.orders, r.total, r.currency])
      );
    }

    const { page, limit, skip } = parsePagination(req);
    return paginatedResponse(res, {
      items: rows.slice(skip, skip + limit),
      total: rows.length,
      page,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/reports/receivables-ageing ─────────────────────────────────────
const OUTSTANDING_INVOICE_STATUSES = ['sent', 'partial', 'overdue'];
const AGEING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];
const DAY_MS = 24 * 60 * 60 * 1000;

const bucketFor = (dueDate, now) => {
  if (!dueDate) return 'current';
  const daysOverdue = Math.floor((now - new Date(dueDate)) / DAY_MS);
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
};

export const getReceivablesAgeing = async (req, res) => {
  try {
    const invoices = await Invoice.find({
      status: { $in: OUTSTANDING_INVOICE_STATUSES },
      balanceDue: { $gt: 0 },
    })
      .select('balanceDue dueDate currency')
      .lean();

    const now = Date.now();
    const buckets = AGEING_BUCKETS.map((bucket) => ({
      bucket,
      count: 0,
      total: 0,
      byCurrency: [],
    }));
    const bucketByName = new Map(buckets.map((b) => [b.bucket, b]));
    let totalOutstanding = 0;

    for (const invoice of invoices) {
      const bucket = bucketByName.get(bucketFor(invoice.dueDate, now));
      const amount = Number(invoice.balanceDue) || 0;
      bucket.count += 1;
      bucket.total = round2(bucket.total + amount);
      totalOutstanding = round2(totalOutstanding + amount);
      const currency = invoice.currency || 'USD';
      let entry = bucket.byCurrency.find((c) => c.currency === currency);
      if (!entry) {
        entry = { currency, count: 0, total: 0 };
        bucket.byCurrency.push(entry);
      }
      entry.count += 1;
      entry.total = round2(entry.total + amount);
    }

    if (req.query.format === 'csv') {
      return sendCsv(
        res,
        'receivables-ageing.csv',
        ['bucket', 'count', 'total'],
        buckets.map((b) => [b.bucket, b.count, b.total])
      );
    }

    return res.status(200).json({
      success: true,
      data: { buckets, totalOutstanding },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/reports/backlog ────────────────────────────────────────────────
const CLOSED_ORDER_STATUSES = [
  ORDER_STATES.DELIVERED,
  ORDER_STATES.CLOSED,
  ORDER_STATES.CANCELLED,
];

export const getBacklogReport = async (req, res) => {
  try {
    const openFilter = { status: { $nin: CLOSED_ORDER_STATUSES } };

    const [grouped, oldest] = await Promise.all([
      Order.aggregate([
        { $match: openFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$totalAmount' },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Order.findOne(openFilter).sort({ createdAt: 1 }).select('orderNumber createdAt').lean(),
    ]);

    const byStatus = grouped.map((g) => ({
      status: g._id,
      count: g.count,
      totalValue: round2(g.totalValue),
    }));

    const oldestOpenOrder = oldest
      ? {
          orderNumber: oldest.orderNumber,
          createdAt: oldest.createdAt,
          ageDays: Math.floor((Date.now() - new Date(oldest.createdAt)) / DAY_MS),
        }
      : null;

    return res.status(200).json({
      success: true,
      data: { byStatus, oldestOpenOrder },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/reports/gstr-export (FEAT-12, v0.9) ──────────────────────────
// GSTR-1-style CSV from stored Invoice fields AS-IS:
// invoiceNumber, invoiceDate, customerDetails.customerName/businessName,
// customerDetails.gstin|taxId (buyer GSTIN), taxableAmount, cgstAmount,
// sgstAmount, igstAmount, grandTotal. Excludes void invoices (Invoice
// status enum has no 'cancelled'; void is the dead state, mirroring
// receivables logic where void is excluded).
export const getGstrExport = async (req, res) => {
  try {
    const match = { status: { $nin: ['void', 'cancelled'] } };
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if (from && !Number.isNaN(from.getTime())) match.invoiceDate = { ...match.invoiceDate, $gte: from };
    if (to && !Number.isNaN(to.getTime())) match.invoiceDate = { ...match.invoiceDate, $lte: to };
    const invoices = await Invoice.find(match).sort({ invoiceDate: 1, createdAt: 1 }).lean();
    const headers = ['invoiceNumber','invoiceDate','buyerName','buyerGstin','taxableValue','CGST','SGST','IGST','total'];
    const rows = invoices.map((inv) => [
      inv.invoiceNumber,
      inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().slice(0,10) : '',
      inv.customerDetails?.customerName || inv.customerDetails?.businessName || '',
      inv.customerDetails?.gstin || inv.customerDetails?.taxId || '',
      inv.taxableAmount ?? '',
      inv.cgstAmount ?? '',
      inv.sgstAmount ?? '',
      inv.igstAmount ?? '',
      inv.grandTotal ?? '',
    ]);
    return sendCsv(res, 'gstr-export.csv', headers, rows);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
