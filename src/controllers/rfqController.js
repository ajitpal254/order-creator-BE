import { RfqSubmission } from '../models/RfqSubmission.js';
import { enqueueEmail } from '../services/outbox.js';
import { parsePagination, paginatedResponse } from '../utils/paginate.js';

export const adminNotificationEmail = () =>
  process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || 'export@haoverseas.com';
// Note: quoteController uses ADMIN_NOTIFICATION_EMAIL || 'export@haoverseas.com' and emailService same; assistant uses SUPPORT/ADMIN fallback. We follow quote pattern, with ADMIN_EMAIL as extra fallback.

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const submitRfq = async (req, res) => {
  try {
    const body = req.body || {};
    // Honeypot
    if (body.website && String(body.website).trim() !== '') {
      return res.status(201).json({ success: true, message: 'RFQ received' });
    }
    const { name, email, company, phone, message, items } = body;
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'Name is required' });
    if (!email || !emailRe.test(String(email).trim())) return res.status(400).json({ success: false, message: 'Valid email is required' });
    if (!message || !String(message).trim()) return res.status(400).json({ success: false, message: 'Message is required' });
    let cleanItems = [];
    if (items !== undefined) {
      if (!Array.isArray(items)) return res.status(400).json({ success: false, message: 'Items must be an array' });
      for (const it of items) {
        if (!it || !it.productName || !String(it.productName).trim() || !(Number(it.quantity) >= 1)) {
          return res.status(400).json({ success: false, message: 'Each item needs productName and quantity >= 1' });
        }
        cleanItems.push({ productName: String(it.productName).trim(), quantity: Number(it.quantity) });
      }
    }
    // Turnstile
    if (process.env.TURNSTILE_SECRET_KEY) {
      const token = body['cf-turnstile-response'] || body.turnstileToken || body.cfTurnstileResponse;
      if (!token) return res.status(400).json({ success: false, message: 'Turnstile verification required' });
      try {
        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: process.env.TURNSTILE_SECRET_KEY, response: token }),
        });
        let data = null;
        try { data = await verifyRes.json(); } catch { data = null; }
        if (!data || data.success !== true) return res.status(400).json({ success: false, message: 'Turnstile verification failed' });
      } catch {
        return res.status(400).json({ success: false, message: 'Turnstile verification failed' });
      }
    }
    const submission = await RfqSubmission.create({
      name: String(name).trim(), email: String(email).trim(), company: company ? String(company).trim() : '', phone: phone ? String(phone).trim() : '', message: String(message), items: cleanItems,
    });
    // Notify staff via outbox; follow admin addressing pattern
    try {
      await enqueueEmail({
        to: adminNotificationEmail(),
        template: 'rfq_received',
        payload: { name: submission.name, customerName: submission.name, email: submission.email, company: submission.company, phone: submission.phone, message: submission.message, items: submission.items, rfqId: submission._id.toString() },
      });
    } catch { /* notification must not fail the submission */ }
    return res.status(201).json({ success: true, data: submission, submission });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};

export const listRfq = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const [data, total] = await Promise.all([
      RfqSubmission.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      RfqSubmission.countDocuments(filter),
    ]);
    return paginatedResponse(res, { items: data, total, page, limit });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};

export const updateRfqStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['new','contacted','closed'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const sub = await RfqSubmission.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!sub) return res.status(404).json({ success: false, message: 'RFQ submission not found' });
    return res.status(200).json({ success: true, data: sub });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
};
