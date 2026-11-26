/**
 * Quote PDF generator (FEAT-02, v0.5)
 *
 * Standalone PDFKit renderer for formal quotations. This file is
 * intentionally independent: it does NOT import or reuse
 * src/utils/pdfGenerator.js (the order/invoice-adjacent PDF generator),
 * and it renders totals exactly as stored on the order — it performs no
 * pricing, tax, or invoice calculations of its own.
 */
import PDFDocument from 'pdfkit';

const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
};

const fmtMoney = (amount, currency = 'USD') => {
  const num = Number(amount);
  if (!Number.isFinite(num)) return `0.00 ${currency}`;
  return `${num.toFixed(2)} ${currency}`;
};

const TERMS_TEXT =
  'Terms: Prices are quoted as stored above under the stated incoterm and currency, ' +
  'excluding duties, taxes and destination charges unless expressly stated otherwise. ' +
  'This quotation is valid until the validity date shown above; after that date prices ' +
  'and lead times are subject to reconfirmation by H.A. Overseas. Payment terms, ' +
  'production lead time and shipment schedule are confirmed in writing once the quote ' +
  'is accepted and converted to a binding order. Goods remain the property of ' +
  'H.A. Overseas until payment is received in full. Any variation to quantity, ' +
  'specification, finish or packaging after acceptance may change the quoted total.';

export const generateQuotePdf = (order) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const MARGIN = 40;
      const CONTENT_WIDTH = 595.28 - MARGIN * 2;
      const currency = order.currency || 'USD';
      const cd = order.customerDetails || {};

      // Header
      doc.rect(MARGIN, MARGIN, CONTENT_WIDTH, 68).fill('#0F172A');
      doc.rect(MARGIN, MARGIN + 68, CONTENT_WIDTH, 3).fill('#D97706');
      doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text('H.A. OVERSEAS', MARGIN + 16, MARGIN + 12);
      doc
        .fontSize(8.5)
        .font('Helvetica')
        .fillColor('#94A3B8')
        .text('Manufacturers & Exporters of Precision Hand Tools & Hardware', MARGIN + 16, MARGIN + 33);
      doc
        .fontSize(7.5)
        .fillColor('#CBD5E1')
        .text('Email: haoverseas1313@gmail.com', MARGIN + 16, MARGIN + 48);

      let y = MARGIN + 88;
      doc.fillColor('#0F172A').fontSize(20).font('Helvetica-Bold').text('QUOTATION', MARGIN, y);
      y += 30;

      doc.fontSize(10).font('Helvetica').fillColor('#111827');
      doc.text(`Quote / Order No: ${order.orderNumber || ''}`, MARGIN, y);
      y += 14;
      doc.text(`Quote Version: ${order.quoteVersion ?? 1}`, MARGIN, y);
      y += 14;
      doc.text(`Date Issued: ${fmtDate(order.updatedAt || order.createdAt)}`, MARGIN, y);
      y += 14;
      doc.text(`Valid Until: ${fmtDate(order.quoteValidityDate)}`, MARGIN, y);
      y += 14;
      doc.text(`Incoterm: ${order.incoterm || 'FOB'}    Currency: ${currency}`, MARGIN, y);
      y += 22;

      // Buyer info
      doc.fontSize(12).font('Helvetica-Bold').text('Buyer', MARGIN, y);
      y += 16;
      doc.fontSize(10).font('Helvetica');
      const buyerLines = [
        cd.customerName,
        cd.businessName,
        cd.address,
        cd.country,
        cd.email,
        cd.phoneNumber,
      ].filter(Boolean);
      for (const line of buyerLines) {
        doc.text(String(line), MARGIN, y);
        y += 13;
      }
      y += 10;

      // Items table header
      const col = {
        name: MARGIN,
        qty: MARGIN + 250,
        unit: MARGIN + 310,
        total: MARGIN + 410,
      };
      doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill('#0F172A');
      doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
      doc.text('Item', col.name + 4, y + 5);
      doc.text('Qty', col.qty, y + 5);
      doc.text('Unit Price', col.unit, y + 5);
      doc.text('Line Total', col.total, y + 5);
      y += 24;

      doc.font('Helvetica').fontSize(9).fillColor('#111827');
      for (const item of order.items || []) {
        if (y > 740) {
          doc.addPage();
          y = MARGIN;
        }
        const name = item.productName || 'Item';
        const skuSuffix = item.sku ? ` (${item.sku})` : '';
        doc.text(`${name}${skuSuffix}`, col.name + 4, y, { width: 240 });
        doc.text(String(item.quantity ?? 0), col.qty, y);
        doc.text(fmtMoney(item.unitPrice, currency), col.unit, y);
        doc.text(fmtMoney(item.totalPrice, currency), col.total, y);
        y += 16;
      }

      y += 10;
      doc.fontSize(10);
      doc.text(`Total Quantity: ${order.totalQuantity ?? 0}`, MARGIN, y);
      y += 14;
      doc.text(`Subtotal: ${fmtMoney(order.subtotalAmount, currency)}`, MARGIN, y);
      y += 14;
      if (Number(order.discountAmount) > 0) {
        doc.text(`Discount: ${fmtMoney(order.discountAmount, currency)}`, MARGIN, y);
        y += 14;
      }
      doc.font('Helvetica-Bold').text(`Total: ${fmtMoney(order.totalAmount, currency)}`, MARGIN, y);
      y += 24;

      doc.fontSize(11).font('Helvetica-Bold').text('Terms & Conditions', MARGIN, y);
      y += 16;
      doc.fontSize(9).font('Helvetica').text(TERMS_TEXT, MARGIN, y, { width: CONTENT_WIDTH, align: 'justify' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

export default generateQuotePdf;
