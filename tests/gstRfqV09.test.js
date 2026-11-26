import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import express from 'express';
import cookieParser from 'cookie-parser';
import { sanitizeMongoInput } from '../src/middleware/mongoSanitize.js';
import gstRoutes from '../src/routes/gstRoutes.js';
import reportRoutes from '../src/routes/reportRoutes.js';
import publicRoutes from '../src/routes/publicRoutes.js';
import adminRoutes from '../src/routes/adminRoutes.js';
import { User } from '../src/models/User.js';
import { Invoice } from '../src/models/Invoice.js';
import { GstRecord } from '../src/models/GstRecord.js';
import { RfqSubmission } from '../src/models/RfqSubmission.js';
import { EmailOutbox } from '../src/models/EmailOutbox.js';
import { generateAccessToken } from '../src/utils/token.js';

function buildApp(){
  const app=express(); app.use(express.json()); app.use(cookieParser()); app.use(sanitizeMongoInput);
  app.use('/api/invoices', gstRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/admin', adminRoutes);
  app.use((err,req,res,next)=>res.status(err.status||500).json({success:false,message:err.message}));
  return app;
}
const makeUser=(o={})=>({customerName:'GST Buyer',businessName:'GST Corp',country:'India',phoneNumber:'+91-1',address:'Addr',username:`u_${Date.now()}_${Math.random().toString(36).slice(2)}`,email:`u_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,password:'<redacted>',role:'user',...o});
let seq=0;
const makeInvoice=(owner,o={})=>({invoiceNumber:`INV-GST-${++seq}`,user:owner._id,customerDetails:{customerName:owner.customerName,email:owner.email,taxId:'29BBBBA0000A1Z5'},status:'sent',currency:'INR',taxableAmount:1000,cgstAmount:90,sgstAmount:90,igstAmount:0,taxAmount:180,grandTotal:1180,invoiceDate:new Date('2026-01-15'),items:[{productName:'Hammer',quantity:1,unitPrice:1000}],...o});

let mongod,app,buyer,buyer2,admin,staff,buyerToken,buyer2Token,adminToken,staffToken,invoice;
const origFetch=global.fetch;
beforeAll(async()=>{
  process.env.SELLER_GSTIN='22AAAAA0000A1Z5';
  process.env.RFQ_RATE_LIMIT_MAX='100';
  delete process.env.GSP_API_URL; delete process.env.GSP_API_KEY; delete process.env.TURNSTILE_SECRET_KEY;
  mongod=await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()); app=buildApp();
  buyer=await User.create(makeUser()); buyer2=await User.create(makeUser()); admin=await User.create(makeUser({role:'admin'})); staff=await User.create(makeUser({role:'sales_manager'}));
  buyerToken=generateAccessToken(buyer); buyer2Token=generateAccessToken(buyer2); adminToken=generateAccessToken(admin); staffToken=generateAccessToken(staff);
},60000);
afterAll(async()=>{ global.fetch=origFetch; await mongoose.disconnect(); await mongod.stop(); },30000);
beforeEach(async()=>{
  await Invoice.deleteMany({}); await GstRecord.deleteMany({}); await RfqSubmission.deleteMany({}); await EmailOutbox.deleteMany({});
  delete process.env.GSP_API_URL; delete process.env.GSP_API_KEY; delete process.env.TURNSTILE_SECRET_KEY;
  process.env.SELLER_GSTIN='22AAAAA0000A1Z5'; process.env.RFQ_RATE_LIMIT_MAX='100';
  global.fetch=origFetch;
  invoice=await Invoice.create(makeInvoice(buyer));
});
afterEach(()=>{ vi.restoreAllMocks(); global.fetch=origFetch; });

describe('gst-qr',()=>{
  it('owner can read payload with stored number/total + seller GSTIN, record created not_generated', async()=>{
    const res=await request(app).get(`/api/invoices/${invoice._id}/gst-qr`).set('Authorization',`Bearer ${buyerToken}`);
    expect(res.status).toBe(200); expect(res.body.success).toBe(true);
    const payload=JSON.parse(res.body.payload);
    expect(payload.invoiceNumber).toBe(invoice.invoiceNumber); expect(payload.totalValue).toBe(1180); expect(payload.sellerGstin).toBe('22AAAAA0000A1Z5'); expect(payload.buyerGstin).toBe('29BBBBA0000A1Z5');
    expect(res.body.record.status).toBe('not_generated');
    const rec=await GstRecord.findOne({invoice:invoice._id}); expect(rec).toBeTruthy(); expect(rec.status).toBe('not_generated');
  });
  it('another buyer denied', async()=>{
    const res=await request(app).get(`/api/invoices/${invoice._id}/gst-qr`).set('Authorization',`Bearer ${buyer2Token}`);
    expect([403,404]).toContain(res.status);
  });
  it('staff can read', async()=>{
    const res=await request(app).get(`/api/invoices/${invoice._id}/gst-qr`).set('Authorization',`Bearer ${staffToken}`);
    expect(res.status).toBe(200);
  });
  it('returns signed payload when present', async()=>{
    await GstRecord.create({invoice:invoice._id,status:'generated',irn:'X',signedQrPayload:'SIGNED-PAYLOAD'});
    const res=await request(app).get(`/api/invoices/${invoice._id}/gst-qr`).set('Authorization',`Bearer ${buyerToken}`);
    expect(res.body.payload).toBe('SIGNED-PAYLOAD');
  });
});

describe('irn',()=>{
  it('without GSP env -> 501 GSP_NOT_CONFIGURED, status stays not_generated', async()=>{
    const res=await request(app).post(`/api/invoices/${invoice._id}/irn`).set('Authorization',`Bearer ${adminToken}`);
    expect(res.status).toBe(501); expect(res.body.code).toBe('GSP_NOT_CONFIGURED');
    // record may not exist or be not_generated
    const rec=await GstRecord.findOne({invoice:invoice._id}); if(rec) expect(rec.status).toBe('not_generated');
  });
  it('buyer rejected (staff only)', async()=>{
    const res=await request(app).post(`/api/invoices/${invoice._id}/irn`).set('Authorization',`Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
  it('mocked fetch success -> generated with irn stored + idempotent', async()=>{
    process.env.GSP_API_URL='https://gsp.example.com/irn'; process.env.GSP_API_KEY='test-key';
    const fetchMock=vi.fn(async()=>({ok:true,status:200,json:async()=>({Irn:'IRN-123',AckNo:'ACK-1',AckDate:new Date().toISOString(),SignedQRCode:'signed-qr-123'})}));
    global.fetch=fetchMock;
    const res=await request(app).post(`/api/invoices/${invoice._id}/irn`).set('Authorization',`Bearer ${adminToken}`);
    expect(res.status).toBe(200); expect(res.body.record.status).toBe('generated'); expect(res.body.record.irn).toBe('IRN-123');
    const rec=await GstRecord.findOne({invoice:invoice._id}); expect(rec.irn).toBe('IRN-123'); expect(rec.signedQrPayload).toBe('signed-qr-123');
    const res2=await request(app).post(`/api/invoices/${invoice._id}/irn`).set('Authorization',`Bearer ${adminToken}`);
    expect(res2.status).toBe(200); expect(fetchMock.mock.calls.length).toBe(1);
  });
  it('mocked failure -> failed + 502', async()=>{
    process.env.GSP_API_URL='https://gsp.example.com/irn'; process.env.GSP_API_KEY='test-key';
    global.fetch=vi.fn(async()=>({ok:false,status:500,json:async()=>({})}));
    const res=await request(app).post(`/api/invoices/${invoice._id}/irn`).set('Authorization',`Bearer ${adminToken}`);
    expect(res.status).toBe(502);
    const rec=await GstRecord.findOne({invoice:invoice._id}); expect(rec.status).toBe('failed'); expect(rec.lastError).toBeTruthy();
  });
});

describe('gstr-export',()=>{
  it('admin gets CSV with header + row matching stored data, void excluded', async()=>{
    await Invoice.create(makeInvoice(buyer,{status:'void'}));
    const res=await request(app).get('/api/reports/gstr-export').set('Authorization',`Bearer ${adminToken}`);
    expect(res.status).toBe(200); expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('invoiceNumber'); expect(res.text).toContain(invoice.invoiceNumber);
    expect(res.text).toContain('1000'); expect(res.text).toContain('90'); expect(res.text).toContain('1180'); expect(res.text).toContain('29BBBBA0000A1Z5');
    // void invoice number should not appear: count occurrences - void invoice has different number
    const lines=res.text.trim().split('\n'); expect(lines.length).toBe(2);
  });
  it('non-admin rejected', async()=>{
    const res=await request(app).get('/api/reports/gstr-export').set('Authorization',`Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
  it('date filter works', async()=>{
    const res=await request(app).get('/api/reports/gstr-export?from=2027-01-01&to=2027-12-31').set('Authorization',`Bearer ${adminToken}`);
    expect(res.status).toBe(200); expect(res.text.trim().split('\n').length).toBe(1);
  });
});

describe('rfq',()=>{
  const valid={name:'Jane Prospect',email:'jane@example.com',company:'Acme',message:'Need hammers',items:[{productName:'Hammer',quantity:10}]};
  it('valid -> 201 + stored + outbox queued', async()=>{
    const res=await request(app).post('/api/public/rfq').send(valid);
    expect(res.status).toBe(201);
    expect(await RfqSubmission.countDocuments()).toBe(1);
    const out=await EmailOutbox.find({}); expect(out.length).toBeGreaterThanOrEqual(1); expect(out[0].template).toBe('rfq_received');
  });
  it('missing/invalid -> 400', async()=>{
    expect((await request(app).post('/api/public/rfq').send({email:'bad'})).status).toBe(400);
    expect((await request(app).post('/api/public/rfq').send({...valid,email:'not-an-email'})).status).toBe(400);
    expect((await request(app).post('/api/public/rfq').send({...valid,items:[{productName:'X',quantity:0}]})).status).toBe(400);
    expect(await RfqSubmission.countDocuments()).toBe(0);
  });
  it('honeypot -> 201 but nothing stored', async()=>{
    const res=await request(app).post('/api/public/rfq').send({...valid,website:'http://spam.example'});
    expect(res.status).toBe(201); expect(await RfqSubmission.countDocuments()).toBe(0);
  });
  it('turnstile failure -> 400, success -> 201', async()=>{
    process.env.TURNSTILE_SECRET_KEY='test-secret';
    global.fetch=vi.fn(async()=>({ok:true,json:async()=>({success:false})}));
    let res=await request(app).post('/api/public/rfq').send({...valid,'cf-turnstile-response':'tok'});
    expect(res.status).toBe(400); expect(await RfqSubmission.countDocuments()).toBe(0);
    global.fetch=vi.fn(async()=>({ok:true,json:async()=>({success:true})}));
    res=await request(app).post('/api/public/rfq').send({...valid,'cf-turnstile-response':'tok'});
    expect(res.status).toBe(201); expect(await RfqSubmission.countDocuments()).toBe(1);
  });
  it('staff list works, buyer cannot, PATCH status works + validates', async()=>{
    await request(app).post('/api/public/rfq').send(valid);
    let res=await request(app).get('/api/admin/rfq').set('Authorization',`Bearer ${staffToken}`);
    expect(res.status).toBe(200); expect(res.body.success).toBe(true); expect(res.body.total).toBe(1); expect(res.body.data.length).toBe(1);
    const id=res.body.data[0]._id;
    res=await request(app).get('/api/admin/rfq').set('Authorization',`Bearer ${buyerToken}`); expect(res.status).toBe(403);
    res=await request(app).patch(`/api/admin/rfq/${id}`).set('Authorization',`Bearer ${staffToken}`).send({status:'contacted'}); expect(res.status).toBe(200); expect(res.body.data.status).toBe('contacted');
    res=await request(app).patch(`/api/admin/rfq/${id}`).set('Authorization',`Bearer ${staffToken}`).send({status:'bogus'}); expect(res.status).toBe(400);
  });
});
