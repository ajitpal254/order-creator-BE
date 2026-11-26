/**
 * assistantV10.test.js
 * FEAT-16 (v1.0) — Assistant Stages 3 + 4:
 * - Anthropic provider (mocked fetch): tool_use round -> tool runs ->
 *   final text; missing key throws; service falls back to rules.
 * - Proposal tools + lifecycle: create_draft_order / reorder create
 *   proposals and NO order; confirm executes per kind; dismiss;
 *   expiry -> 410; cross-user confirm -> 404.
 * - Staff gating: staffOnly tools hidden from buyer schemas and
 *   refused on execute; staff copilot works; overdue list read-only;
 *   draft_reply sends nothing.
 * - PO extraction: CSV / XLSX / PDF fixtures parsed + matched;
 *   po_draft confirm 422 with an unmatched line, 201 when all matched.
 * - WhatsApp channel: GET handshake, unknown/known sender POST,
 *   signature verification, inactive channel 404.
 * All external calls are mocked — no real APIs are touched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';

process.env.JWT_SECRET = 'assistant-v10-test-secret-0123456789abcdef';

import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import { jsonBodyParser, urlencodedBodyParser } from '../src/middleware/bodyParsers.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';
import assistantRoutes from '../src/routes/assistantRoutes.js';
import whatsappRoutes from '../src/routes/whatsappRoutes.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { Invoice } from '../src/models/Invoice.js';
import { AssistantProposal } from '../src/models/AssistantProposal.js';
import { AssistantConversation } from '../src/models/AssistantConversation.js';
import { MessageLog } from '../src/models/MessageLog.js';
import { EmailOutbox } from '../src/models/EmailOutbox.js';
import { generateAccessToken } from '../src/utils/token.js';
import { executeToolByName, toolSchemas } from '../src/services/assistant/tools.js';
import { anthropicProvider } from '../src/services/assistant/anthropicProvider.js';
import { AssistantProviderError } from '../src/services/assistant/errors.js';
import { KNOWLEDGE } from '../src/services/assistant/knowledge.js';
import { metaWhatsAppAdapter } from '../src/services/messaging.js';

function buildTestApp() {
  const app = express();
  // WhatsApp routes are mounted BEFORE the global JSON parser,
  // exactly as in src/server.js (raw body for signature checks).
  app.use('/api/assistant/whatsapp', whatsappRoutes);
  app.use(jsonBodyParser);
  app.use(urlencodedBodyParser);
  app.use(cookieParser());
  app.use(sanitizeMongoInput);
  app.use('/api/assistant', assistantRoutes);
  app.use(globalErrorHandler);
  return app;
}

const makeUser = (overrides = {}) => ({
  customerName: 'V10 Buyer',
  businessName: 'V10 Corp',
  country: 'Canada',
  phoneNumber: '+1-555-0199',
  address: '99 Secret Lane',
  username: `v10_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  email: `v10_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
  password: 'testpassword123',
  role: 'user',
  ...overrides,
});

let mongod;
let app;
let buyerA, tokenA;
let buyerB, tokenB;
let staff;
let product, product2;
let orderA;
const originalFetch = globalThis.fetch;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const sendMsg = (token, message, extra = {}) =>
  request(app).post('/api/assistant/message').set(auth(token)).send({ message, ...extra });

const clearAssistantEnv = () => {
  delete process.env.ASSISTANT_PROVIDER;
  delete process.env.ASSISTANT_MODEL;
  delete process.env.ASSISTANT_DAILY_CAP;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.WHATSAPP_APP_SECRET;
};

beforeAll(async () => {
  clearAssistantEnv();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = buildTestApp();

  buyerA = await User.create(makeUser({ distributorTier: 'Gold' }));
  tokenA = generateAccessToken(buyerA);
  buyerB = await User.create(makeUser({ distributorTier: 'Standard' }));
  tokenB = generateAccessToken(buyerB);
  staff = await User.create(makeUser({ role: 'admin', customerName: 'V10 Staff' }));

  product = await Product.create({
    name: 'Claw Hammer',
    sku: 'V10-HMR-001',
    category: 'Hand Tools',
    description: 'Forged steel claw hammer',
    basePrice: 100,
    currency: 'USD',
    moq: 50,
    isActive: true,
  });
  product2 = await Product.create({
    name: 'Ball Pein Hammer',
    sku: 'V10-HMR-002',
    category: 'Hand Tools',
    description: 'Ball pein hammer',
    basePrice: 50,
    currency: 'USD',
    moq: 50,
    isActive: true,
  });

  orderA = await Order.create({
    orderNumber: 'HAO-2026-910001',
    orderType: 'Order',
    user: buyerA._id,
    customerDetails: {
      customerName: buyerA.customerName,
      businessName: buyerA.businessName,
      country: buyerA.country,
      phoneNumber: buyerA.phoneNumber,
      address: buyerA.address,
      email: buyerA.email,
    },
    items: [
      { productName: 'Claw Hammer', sku: 'V10-HMR-001', quantity: 10, unitPrice: 88, totalPrice: 880 },
    ],
    totalQuantity: 10,
    subtotalAmount: 1000,
    discountPercent: 12,
    discountAmount: 120,
    totalAmount: 880,
    currency: 'USD',
    status: 'Confirmed',
    timeline: [
      { status: 'Submitted', updatedBy: 'buyer', updatedAt: new Date('2026-11-01T10:00:00Z') },
      { status: 'Confirmed', updatedBy: 'staff', updatedAt: new Date('2026-11-02T10:00:00Z') },
    ],
  });

  const tenDaysAgo = new Date(Date.now() - 10.5 * 24 * 60 * 60 * 1000);
  await Invoice.create({
    invoiceNumber: 'INV-V10-OVERDUE',
    status: 'sent',
    order: orderA._id,
    user: buyerA._id,
    customerDetails: { customerName: buyerA.customerName, email: buyerA.email },
    items: [],
    currency: 'USD',
    grandTotal: 750,
    amountPaid: 0,
    balanceDue: 750,
    dueDate: tenDaysAgo,
  });
  await Invoice.create({
    invoiceNumber: 'INV-V10-PAID',
    status: 'paid',
    order: orderA._id,
    user: buyerA._id,
    customerDetails: { customerName: buyerA.customerName, email: buyerA.email },
    items: [],
    currency: 'USD',
    grandTotal: 100,
    amountPaid: 100,
    balanceDue: 0,
    dueDate: tenDaysAgo,
  });
  await Invoice.create({
    invoiceNumber: 'INV-V10-FUTURE',
    status: 'sent',
    order: orderA._id,
    user: buyerA._id,
    customerDetails: { customerName: buyerA.customerName, email: buyerA.email },
    items: [],
    currency: 'USD',
    grandTotal: 200,
    amountPaid: 0,
    balanceDue: 200,
    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
  });
}, 60000);

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await mongoose.disconnect();
  await mongod.stop();
}, 30000);

beforeEach(async () => {
  await AssistantProposal.deleteMany({});
  await AssistantConversation.deleteMany({});
  await MessageLog.deleteMany({});
  await EmailOutbox.deleteMany({});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearAssistantEnv();
  vi.restoreAllMocks();
});

// ── Anthropic provider ─────────────────────────────────────────────────────
describe('anthropic provider (mocked fetch)', () => {
  it('runs a tool_use round, executes the tool, and returns the final text', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'search_products', input: { query: 'hammer' } },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'I found the Claw Hammer for you.' }],
        }),
      });
    globalThis.fetch = fetchSpy;

    const result = await anthropicProvider.respond({
      messages: [{ role: 'user', content: 'Find hammer' }],
      user: buyerA,
      toolSchemas: toolSchemas(buyerA),
      executeTool: (name, args) => executeToolByName(buyerA, name, args),
    });

    expect(result.reply).toBe('I found the Claw Hammer for you.');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('test-anthropic-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const firstBody = JSON.parse(init.body);
    expect(firstBody.model).toBe('claude-haiku-4-5');
    expect(firstBody.max_tokens).toBe(1024);
    expect(firstBody.system).toContain('H.A. Overseas');
    expect(firstBody.tools[0]).toHaveProperty('input_schema');
    // Second call carries the tool_result with the real product in it.
    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    const toolMsg = secondBody.messages[secondBody.messages.length - 1];
    expect(toolMsg.role).toBe('user');
    expect(toolMsg.content[0].type).toBe('tool_result');
    expect(toolMsg.content[0].tool_use_id).toBe('toolu_1');
    expect(toolMsg.content[0].content).toContain('Claw Hammer');
  });

  it('throws AssistantProviderError when the API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      anthropicProvider.respond({
        messages: [{ role: 'user', content: 'hi' }],
        user: buyerA,
        toolSchemas: [],
        executeTool: async () => ({}),
      })
    ).rejects.toBeInstanceOf(AssistantProviderError);
  });

  it('service falls back to rules when anthropic is selected but unconfigured', async () => {
    process.env.ASSISTANT_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    const res = await sendMsg(tokenA, 'What is your lead time?');
    expect(res.status).toBe(200);
    const entry = KNOWLEDGE.find((k) => k.id === 'lead-time');
    expect(res.body.reply).toContain(entry.answer.slice(0, 40));
  });

  it('proposal created via an anthropic tool round is surfaced on the message response', async () => {
    process.env.ASSISTANT_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_9',
              name: 'create_draft_order',
              input: { items: [{ productId: product._id.toString(), quantity: 10 }] },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'I have prepared a draft proposal for you to confirm.' }],
        }),
      });

    const ordersBefore = await Order.countDocuments({});
    const res = await sendMsg(tokenA, 'Order 10 claw hammers please');
    expect(res.status).toBe(200);
    expect(res.body.proposal).toBeTruthy();
    expect(res.body.proposal.kind).toBe('draft_order');
    expect(res.body.proposal.status).toBe('pending');
    expect(await Order.countDocuments({})).toBe(ordersBefore);
  });
});

// ── Staff gating ───────────────────────────────────────────────────────────
describe('staff gating', () => {
  it('staffOnly tools are absent from buyer + anonymous schemas, present for staff', () => {
    const staffNames = ['summarise_order', 'list_overdue_invoices', 'draft_reply'];
    const anonymous = toolSchemas().map((t) => t.name);
    const buyer = toolSchemas(buyerA).map((t) => t.name);
    const staffList = toolSchemas(staff).map((t) => t.name);
    for (const name of staffNames) {
      expect(anonymous).not.toContain(name);
      expect(buyer).not.toContain(name);
      expect(staffList).toContain(name);
    }
    // Non-staff tools still visible to everyone.
    expect(buyer).toContain('create_draft_order');
    expect(staffList).toContain('search_products');
  });

  it('executeToolByName refuses staff tools for buyers', async () => {
    expect(await executeToolByName(buyerA, 'list_overdue_invoices', {})).toEqual({
      error: 'not_found_or_not_yours',
    });
    expect(
      await executeToolByName(buyerA, 'summarise_order', { orderId: orderA._id.toString() })
    ).toEqual({ error: 'not_found_or_not_yours' });
    expect(
      await executeToolByName(buyerA, 'draft_reply', { orderId: orderA._id.toString(), intent: 'general' })
    ).toEqual({ error: 'not_found_or_not_yours' });
  });

  it('staff summarise_order returns a structured summary of any order', async () => {
    const result = await executeToolByName(staff, 'summarise_order', {
      orderId: orderA.orderNumber,
    });
    expect(result.orderNumber).toBe(orderA.orderNumber);
    expect(result.buyer.name).toBe(buyerA.customerName);
    expect(result.buyer.company).toBe(buyerA.businessName);
    expect(result.status).toBe('Confirmed');
    expect(result.items).toBe(1);
    expect(result.totalAmount).toBe(880);
    expect(result.timeline.lastState).toBe('Confirmed');
    // Nonexistent -> refusal
    expect(
      await executeToolByName(staff, 'summarise_order', { orderId: 'HAO-2026-000000' })
    ).toEqual({ error: 'not_found_or_not_yours' });
  });

  it('staff list_overdue_invoices is read-only shape, worst first, paid/future excluded', async () => {
    const result = await executeToolByName(staff, 'list_overdue_invoices', {});
    expect(result.invoices).toHaveLength(1);
    const inv = result.invoices[0];
    expect(inv.invoiceNumber).toBe('INV-V10-OVERDUE');
    expect(inv.orderNumber).toBe(orderA.orderNumber);
    expect(inv.buyerName).toBe(buyerA.customerName);
    expect(inv.totalAmount).toBe(750);
    expect(inv.daysOverdue).toBe(10);
    // Read-only: nothing changed.
    expect((await Invoice.findOne({ invoiceNumber: 'INV-V10-OVERDUE' })).status).toBe('sent');
  });

  it('staff draft_reply returns text only and sends nothing', async () => {
    const result = await executeToolByName(staff, 'draft_reply', {
      orderId: orderA._id.toString(),
      intent: 'payment_reminder',
    });
    expect(typeof result.draft).toBe('string');
    expect(result.draft).toContain(orderA.orderNumber);
    expect(await MessageLog.countDocuments({})).toBe(0);
    expect(await EmailOutbox.countDocuments({})).toBe(0);
  });
});

// ── Proposal lifecycle ─────────────────────────────────────────────────────
describe('proposal lifecycle', () => {
  it('create_draft_order tool creates a proposal and NO order', async () => {
    const ordersBefore = await Order.countDocuments({});
    const result = await executeToolByName(buyerA, 'create_draft_order', {
      items: [{ productId: product._id.toString(), quantity: 100 }],
    });
    expect(result.status).toBe('pending');
    expect(result.proposalId).toBeTruthy();
    expect(result.note).toContain('nothing has been ordered');
    expect(result.summary).toContain('Claw Hammer');
    // Gold tier: 100 x 88 = 8800 indicative
    expect(result.summary).toContain('8800.00');
    expect(await Order.countDocuments({})).toBe(ordersBefore);
    const proposal = await AssistantProposal.findById(result.proposalId);
    expect(proposal.kind).toBe('draft_order');
    expect(proposal.user.toString()).toBe(buyerA._id.toString());
  });

  it('confirm creates a Draft order owned by the user with catalog pricing', async () => {
    const { proposalId } = await executeToolByName(buyerA, 'create_draft_order', {
      items: [{ productId: product._id.toString(), quantity: 10 }],
    });
    const res = await request(app)
      .post(`/api/assistant/proposals/${proposalId}/confirm`)
      .set(auth(tokenA))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe('Draft');
    expect(res.body.order.user.toString()).toBe(buyerA._id.toString());
    expect(res.body.order.items).toHaveLength(1);
    // Server-side catalog pricing: base 100, Gold 12% -> 88.
    expect(res.body.order.items[0].unitPrice).toBe(88);
    expect(res.body.order.totalAmount).toBe(880);
    const proposal = await AssistantProposal.findById(proposalId);
    expect(proposal.status).toBe('confirmed');
    expect(proposal.createdOrder.toString()).toBe(res.body.order._id);
    // Second confirm -> 409
    const again = await request(app)
      .post(`/api/assistant/proposals/${proposalId}/confirm`)
      .set(auth(tokenA))
      .send({});
    expect(again.status).toBe(409);
  });

  it('cross-user confirm and dismiss are 404', async () => {
    const { proposalId } = await executeToolByName(buyerA, 'create_draft_order', {
      items: [{ productId: product._id.toString(), quantity: 5 }],
    });
    const confirm = await request(app)
      .post(`/api/assistant/proposals/${proposalId}/confirm`)
      .set(auth(tokenB))
      .send({});
    expect(confirm.status).toBe(404);
    const dismiss = await request(app)
      .post(`/api/assistant/proposals/${proposalId}/dismiss`)
      .set(auth(tokenB))
      .send({});
    expect(dismiss.status).toBe(404);
    expect((await AssistantProposal.findById(proposalId)).status).toBe('pending');
  });

  it('dismiss marks the proposal dismissed', async () => {
    const { proposalId } = await executeToolByName(buyerA, 'create_draft_order', {
      items: [{ productId: product2._id.toString(), quantity: 5 }],
    });
    const res = await request(app)
      .post(`/api/assistant/proposals/${proposalId}/dismiss`)
      .set(auth(tokenA))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('dismissed');
  });

  it('expired proposal confirm returns 410', async () => {
    const { proposalId } = await executeToolByName(buyerA, 'create_draft_order', {
      items: [{ productId: product._id.toString(), quantity: 5 }],
    });
    await AssistantProposal.updateOne(
      { _id: proposalId },
      { $set: { expiresAt: new Date(Date.now() - 60 * 1000) } }
    );
    const res = await request(app)
      .post(`/api/assistant/proposals/${proposalId}/confirm`)
      .set(auth(tokenA))
      .send({});
    expect(res.status).toBe(410);
    expect((await AssistantProposal.findById(proposalId)).status).toBe('expired');
  });

  it('reorder tool refuses another user order; own reorder confirms into a copied draft', async () => {
    const refused = await executeToolByName(buyerB, 'reorder', {
      orderId: orderA._id.toString(),
    });
    expect(refused).toEqual({ error: 'not_found_or_not_yours' });

    const ordersBefore = await Order.countDocuments({});
    const result = await executeToolByName(buyerA, 'reorder', { orderId: orderA.orderNumber });
    expect(result.status).toBe('pending');
    expect(await Order.countDocuments({})).toBe(ordersBefore);

    const res = await request(app)
      .post(`/api/assistant/proposals/${result.proposalId}/confirm`)
      .set(auth(tokenA))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe('Draft');
    expect(res.body.order._id).not.toBe(orderA._id.toString());
    expect(res.body.order.totalAmount).toBe(orderA.totalAmount);
    expect(res.body.order.items[0].productName).toBe('Claw Hammer');
  });
});

// ── PO extraction ──────────────────────────────────────────────────────────
describe('PO extraction', () => {
  const extract = (token, buffer, filename) =>
    request(app)
      .post('/api/assistant/extract-po')
      .set(auth(token))
      .attach('file', buffer, filename);

  it('CSV fixture: lines matched/unmatched correctly + po_draft proposal created', async () => {
    const csv = [
      'Product Name,Quantity,Unit Price',
      'Claw Hammer,100,12.50',
      'Unknown Widget,5,1.00',
      '',
    ].join('\n');
    const res = await extract(tokenA, Buffer.from(csv), 'po.csv');
    expect(res.status).toBe(201);
    expect(res.body.proposal.kind).toBe('po_draft');
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.lines[0]).toMatchObject({
      name: 'Claw Hammer',
      quantity: 100,
      unitPrice: 12.5,
      productId: product._id.toString(),
      matched: true,
    });
    expect(res.body.lines[1]).toMatchObject({ name: 'Unknown Widget', matched: false });
    expect(res.body.lines[1].productId).toBeNull();
    const proposal = await AssistantProposal.findById(res.body.proposal.id);
    expect(proposal.payload.sourceFileName).toBe('po.csv');
    expect(proposal.payload.lines).toHaveLength(2);
  });

  it('po_draft confirm with an unmatched line returns 422 and creates nothing', async () => {
    const csv = 'Name,Qty\nClaw Hammer,10\nUnknown Widget,5\n';
    const res = await extract(tokenA, Buffer.from(csv), 'po.csv');
    expect(res.status).toBe(201);
    const ordersBefore = await Order.countDocuments({});
    const confirm = await request(app)
      .post(`/api/assistant/proposals/${res.body.proposal.id}/confirm`)
      .set(auth(tokenA))
      .send({});
    expect(confirm.status).toBe(422);
    expect(confirm.body.unmatched).toHaveLength(1);
    expect(confirm.body.unmatched[0].name).toBe('Unknown Widget');
    expect(await Order.countDocuments({})).toBe(ordersBefore);
  });

  it('po_draft confirm with all lines matched creates a 201 draft order', async () => {
    const csv = 'Name,Qty,Price\nClaw Hammer,10,99.99\nBall Pein Hammer,20,1.00\n';
    const res = await extract(tokenA, Buffer.from(csv), 'po.csv');
    expect(res.status).toBe(201);
    expect(res.body.lines.every((l) => l.matched)).toBe(true);
    const confirm = await request(app)
      .post(`/api/assistant/proposals/${res.body.proposal.id}/confirm`)
      .set(auth(tokenA))
      .send({});
    expect(confirm.status).toBe(201);
    expect(confirm.body.order.status).toBe('Draft');
    expect(confirm.body.order.items).toHaveLength(2);
    // Catalog pricing wins over PO-stated prices: Claw 88 x10 + BallPein 44 x20.
    expect(confirm.body.order.items[0].unitPrice).toBe(88);
    expect(confirm.body.order.totalAmount).toBe(880 + 880);
  });

  it('XLSX fixture generated with the xlsx lib parses and matches', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Item Name', 'Quantity', 'Unit Price'],
      ['Ball Pein Hammer', 50, 8.0],
      ['Mystery Part', 3, 2.5],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PO');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const res = await extract(tokenA, buffer, 'po.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.lines[0]).toMatchObject({
      name: 'Ball Pein Hammer',
      quantity: 50,
      productId: product2._id.toString(),
      matched: true,
    });
    expect(res.body.lines[1].matched).toBe(false);
  });

  it('PDF fixture generated with pdfkit parses lines per the documented grammar', async () => {
    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument();
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.text('Claw Hammer 100 12.50');
      doc.text('Ball Pein Hammer 50 8.00');
      doc.end();
    });
    const res = await extract(tokenA, pdfBuffer, 'po.pdf');
    expect(res.status).toBe(201);
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.lines[0]).toMatchObject({
      name: 'Claw Hammer',
      quantity: 100,
      unitPrice: 12.5,
      matched: true,
    });
    expect(res.body.lines[1]).toMatchObject({ name: 'Ball Pein Hammer', quantity: 50, matched: true });
  });
});

// ── WhatsApp channel ───────────────────────────────────────────────────────
describe('WhatsApp channel', () => {
  const waPayload = (from, text) => ({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ from, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  });

  const configureAdapter = () => {
    process.env.WHATSAPP_TOKEN = 'test-wa-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  };

  it('GET handshake succeeds with the right token and fails otherwise', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me';
    const ok = await request(app)
      .get('/api/assistant/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'CH-123' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('CH-123');
    const bad = await request(app)
      .get('/api/assistant/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'CH-123' });
    expect(bad.status).toBe(403);
  });

  it('GET handshake is 404 when WHATSAPP_VERIFY_TOKEN is unset', async () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    const res = await request(app)
      .get('/api/assistant/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': 'y' });
    expect(res.status).toBe(404);
  });

  it('POST is 404 when the channel is inactive (no WHATSAPP_TOKEN)', async () => {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const res = await request(app)
      .post('/api/assistant/whatsapp/webhook')
      .send(waPayload('14155550123', 'hi'));
    expect(res.status).toBe(404);
  });

  it('POST from an unknown sender only attempts the link-account reply', async () => {
    configureAdapter();
    const sendTextSpy = vi
      .spyOn(metaWhatsAppAdapter, 'sendText')
      .mockResolvedValue({ messageId: 'wamid.LINK' });
    const res = await request(app)
      .post('/api/assistant/whatsapp/webhook')
      .send(waPayload('19998887777', 'Where is my order?'));
    expect(res.status).toBe(200);
    expect(sendTextSpy).toHaveBeenCalledTimes(1);
    expect(sendTextSpy.mock.calls[0][0].to).toBe('19998887777');
    expect(sendTextSpy.mock.calls[0][0].body).toContain('not linked');
    // No assistant conversation was created for the unknown sender.
    expect(await AssistantConversation.countDocuments({})).toBe(0);
  });

  it('POST from a known sender runs the assistant and sends its reply', async () => {
    configureAdapter();
    await User.updateOne({ _id: buyerA._id }, { $set: { phone: '+14155550123' } });
    const sendTextSpy = vi
      .spyOn(metaWhatsAppAdapter, 'sendText')
      .mockResolvedValue({ messageId: 'wamid.OK' });
    const res = await request(app)
      .post('/api/assistant/whatsapp/webhook')
      .send(waPayload('14155550123', 'What is your lead time?'));
    expect(res.status).toBe(200);
    expect(sendTextSpy).toHaveBeenCalledTimes(1);
    const entry = KNOWLEDGE.find((k) => k.id === 'lead-time');
    expect(sendTextSpy.mock.calls[0][0].body).toContain(entry.answer.slice(0, 40));
    expect(await AssistantConversation.countDocuments({ user: buyerA._id })).toBe(1);
    await User.updateOne({ _id: buyerA._id }, { $set: { phone: '' } });
  });

  it('POST with a bad signature is 401 when WHATSAPP_APP_SECRET is set; a valid one passes', async () => {
    configureAdapter();
    process.env.WHATSAPP_APP_SECRET = 'wa-app-secret';
    const payload = waPayload('19998887777', 'hello');
    const raw = JSON.stringify(payload);

    const bad = await request(app)
      .post('/api/assistant/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send(raw);
    expect(bad.status).toBe(401);

    const sendTextSpy = vi
      .spyOn(metaWhatsAppAdapter, 'sendText')
      .mockResolvedValue({ messageId: 'wamid.SIG' });
    const goodSig =
      'sha256=' + crypto.createHmac('sha256', 'wa-app-secret').update(raw).digest('hex');
    const good = await request(app)
      .post('/api/assistant/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', goodSig)
      .send(raw);
    expect(good.status).toBe(200);
    expect(sendTextSpy).toHaveBeenCalledTimes(1);
  });
});
