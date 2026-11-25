/**
 * Export Commercial Invoice generator (FEAT-08, v0.8).
 *
 * IMPORTANT: this is a standalone EXPORT document rendered from order
 * data. It is NOT the system's invoice — it does not import or touch
 * the invoice PDF generator, the Invoice model, or any invoice totals /
 * tax logic. Amounts below are the order's STORED totals, printed
 * as-is; no tax or total is recomputed here.
 */
import {
  createPdfBuffer,
  drawHeader,
  drawOrderMeta,
  drawPartyBlock,
  consigneeLines,
  exporterLines,
  fmtMoney,
  MARGIN,
  CONTENT_WIDTH,
} from './pdfHelper.js';

export const generateExportCommercialInvoice = (order) =>
  createPdfBuffer((doc) => {
    const currency = order.currency || 'USD';
    let y = drawHeader(doc, 'Export Commercial Invoice');
    y = drawOrderMeta(doc, order, y);
    y = drawPartyBlock(doc, 'Exporter', exporterLines(), y);
    y = drawPartyBlock(doc, 'Consignee', consigneeLines(order), y);

    const col = {
      item: MARGIN,
      qty: MARGIN + 250,
      unit: MARGIN + 310,
      total: MARGIN + 415,
    };
    doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill('#0F172A');
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
    doc.text('Item', col.item + 4, y + 5);
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
      doc.text(`${name}${skuSuffix}`, col.item + 4, y, { width: 240 });
      doc.text(String(item.quantity ?? 0), col.qty, y);
      doc.text(fmtMoney(item.unitPrice, currency), col.unit, y);
      doc.text(fmtMoney(item.totalPrice, currency), col.total, y);
      y += 16;
    }

    // Stored order totals, printed as-is (never recomputed).
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
    doc
      .font('Helvetica-Bold')
      .text(`Total: ${fmtMoney(order.totalAmount, currency)}`, MARGIN, y);
    y += 24;

    doc
      .fontSize(8.5)
      .font('Helvetica')
      .fillColor('#475569')
      .text(
        'This Export Commercial Invoice is generated from order data for shipping/customs ' +
          'purposes and is separate from the invoice issued for this order.',
        MARGIN,
        y,
        { width: CONTENT_WIDTH }
      );
  });

export default generateExportCommercialInvoice;
