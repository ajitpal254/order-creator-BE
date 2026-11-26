import { Invoice } from '../models/Invoice.js';
import { Order } from '../models/Order.js';
import { GstRecord } from '../models/GstRecord.js';

export const STAFF_ROLES = ['admin','sales_manager','production_supervisor','qc_inspector','shipping_officer','super_admin'];
export const isStaffUser = (user) => user && STAFF_ROLES.includes(user.role);

export const getBuyerGstin = async (invoice) => {
  const cd = invoice?.customerDetails || {};
  if (cd.gstin) return cd.gstin;
  if (cd.taxId) return cd.taxId;
  if (cd.gstIn) return cd.gstIn;
  if (invoice?.buyerGstin) return invoice.buyerGstin;
  if (invoice?.order) {
    try {
      const orderId = invoice.order._id || invoice.order;
      const order = await Order.findById(orderId).lean();
      const ocd = order?.customerDetails || {};
      if (ocd.gstin) return ocd.gstin;
      if (ocd.taxId) return ocd.taxId;
    } catch { /* order lookup is best-effort */ }
  }
  return null;
};

export const findInvoiceWithAccess = async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) { res.status(404).json({ success: false, message: 'Invoice not found' }); return null; }
  const invoiceUserId = invoice.user?._id ? invoice.user._id.toString() : invoice.user?.toString();
  const reqUserId = req.user?._id?.toString();
  if (invoiceUserId !== reqUserId && !isStaffUser(req.user)) {
    res.status(403).json({ success: false, message: 'Not authorized to view this invoice' });
    return null;
  }
  return invoice;
};

export const getGstQr = async (req, res) => {
  try {
    const invoice = await findInvoiceWithAccess(req, res);
    if (!invoice) return;
    let record = await GstRecord.findOne({ invoice: invoice._id });
    if (!record) record = await GstRecord.create({ invoice: invoice._id });
    let payload;
    if (record.signedQrPayload) {
      payload = record.signedQrPayload;
    } else {
      const buyerGstin = await getBuyerGstin(invoice);
      payload = JSON.stringify({
        sellerGstin: process.env.SELLER_GSTIN || invoice.senderDetails?.gstin || null,
        buyerGstin: buyerGstin || null,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate ? new Date(invoice.invoiceDate).toISOString() : null,
        totalValue: invoice.grandTotal,
      });
    }
    return res.status(200).json({ success: true, payload, record });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};

export const generateIrn = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    let record = await GstRecord.findOne({ invoice: invoice._id });
    if (!record) record = await GstRecord.create({ invoice: invoice._id });
    if (record.status === 'generated' && record.irn) {
      return res.status(200).json({ success: true, record, data: record });
    }
    if (!process.env.GSP_API_URL || !process.env.GSP_API_KEY) {
      return res.status(501).json({ success: false, code: 'GSP_NOT_CONFIGURED', message: 'GSP is not configured' });
    }
    record.status = 'pending'; await record.save();
    const buyerGstin = await getBuyerGstin(invoice);
    try {
      const response = await fetch(process.env.GSP_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GSP_API_KEY}` },
        body: JSON.stringify({
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          totalValue: invoice.grandTotal,
          grandTotal: invoice.grandTotal,
          taxableAmount: invoice.taxableAmount,
          cgstAmount: invoice.cgstAmount, sgstAmount: invoice.sgstAmount, igstAmount: invoice.igstAmount,
          taxAmount: invoice.taxAmount,
          sellerGstin: process.env.SELLER_GSTIN || invoice.senderDetails?.gstin || null,
          buyerGstin: buyerGstin || null,
        }),
      });
      if (!response || response.ok === false || (response.status && response.status >= 400)) {
        throw new Error(`GSP request failed with status ${response?.status || 'unknown'}`);
      }
      let data;
      try { data = typeof response.json === 'function' ? await response.json() : null; } catch { throw new Error('Unparseable GSP response'); }
      const nested = data?.data || data?.Data || data || {};
      const irn = data?.irn || data?.Irn || nested?.irn || nested?.Irn;
      const ackNo = data?.ackNo || data?.AckNo || nested?.ackNo || nested?.AckNo || null;
      const ackDateRaw = data?.ackDate || data?.AckDate || nested?.ackDate || nested?.AckDate || null;
      const signed = data?.signedQrPayload || data?.SignedQRCode || data?.signedQRCode || data?.SignedQrCode || nested?.signedQrPayload || nested?.SignedQRCode || nested?.signedQRCode || null;
      if (!irn && !signed && !ackNo) throw new Error('Unparseable GSP response: missing IRN');
      record.irn = irn || null;
      record.ackNo = ackNo ? String(ackNo) : null;
      record.ackDate = ackDateRaw ? new Date(ackDateRaw) : null;
      if (record.ackDate && Number.isNaN(record.ackDate.getTime())) record.ackDate = null;
      record.signedQrPayload = signed ? (typeof signed === 'string' ? signed : JSON.stringify(signed)) : null;
      record.status = 'generated'; record.lastError = null; await record.save();
      return res.status(200).json({ success: true, record, data: record });
    } catch (err) {
      record.status = 'failed'; record.lastError = err.message; await record.save();
      return res.status(502).json({ success: false, message: err.message, record });
    }
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};
