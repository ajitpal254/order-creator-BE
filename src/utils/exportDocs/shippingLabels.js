/**
 * Shipping-mark labels generator (FEAT-08, v0.8).
 *
 * One label per carton when the order stores an estimated carton count
 * ("Carton 3 of 12"); otherwise a single label. Each label carries the
 * order number, the consignee from the order's customer details, and
 * the order's shipping marks / custom markings when present.
 */
import { createPdfBuffer, consigneeLines, MARGIN } from './pdfHelper.js';

const LABEL_W = 515;
const LABEL_H = 290;

const drawLabel = (doc, order, cartonIndex, cartonTotal) => {
  const x = MARGIN;
  const y = MARGIN;
  doc.rect(x, y, LABEL_W, LABEL_H).lineWidth(2).stroke('#0F172A');
  doc.rect(x, y, LABEL_W, 44).fill('#0F172A');
  doc
    .fillColor('#FFFFFF')
    .fontSize(15)
    .font('Helvetica-Bold')
    .text('H.A. OVERSEAS', x + 14, y + 8);
  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#CBD5E1')
    .text('SHIPPING LABEL', x + 14, y + 28);

  let ly = y + 58;
  doc.fillColor('#111827');
  doc.fontSize(13).font('Helvetica-Bold').text(`Order No: ${order.orderNumber || ''}`, x + 14, ly);
  ly += 22;
  if (cartonTotal > 1) {
    doc.fontSize(11).text(`Carton ${cartonIndex} of ${cartonTotal}`, x + 14, ly);
    ly += 18;
  }

  ly += 4;
  doc.fontSize(10).font('Helvetica-Bold').text('Consignee:', x + 14, ly);
  ly += 15;
  doc.font('Helvetica').fontSize(10);
  for (const line of consigneeLines(order)) {
    doc.text(String(line), x + 14, ly, { width: LABEL_W - 28 });
    ly += 13;
  }

  const marks = [order.shippingMarks, ...(order.items || []).map((it) => it.customMarking)]
    .filter((v) => v != null && String(v).trim() !== '')
    .map(String);
  if (marks.length > 0) {
    ly += 8;
    doc.fontSize(10).font('Helvetica-Bold').text('Shipping Marks:', x + 14, ly);
    ly += 15;
    doc.font('Helvetica').fontSize(10);
    for (const mark of [...new Set(marks)]) {
      doc.text(mark, x + 14, ly, { width: LABEL_W - 28 });
      ly += 13;
    }
  }

  if (order.incoterm) {
    doc
      .fontSize(9)
      .fillColor('#475569')
      .text(`Incoterm: ${order.incoterm}`, x + 14, y + LABEL_H - 22);
  }
};

export const generateShippingLabels = (order) =>
  createPdfBuffer((doc) => {
    const total = Number(order.estimatedCartons) > 0 ? Math.floor(Number(order.estimatedCartons)) : 1;
    for (let i = 1; i <= total; i += 1) {
      if (i > 1) doc.addPage();
      drawLabel(doc, order, i, total);
    }
  });

export default generateShippingLabels;
