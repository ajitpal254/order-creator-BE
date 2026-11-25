/**
 * Packing List generator (FEAT-08, v0.8) — standalone, order data only.
 *
 * Weights/dimensions come from what is actually stored: each order item
 * carries a frozen snapshot (snapshot.weightKg, snapshot.pcsPerCarton)
 * captured at submission time, plus packaging/customMarking fields.
 * Anything absent is simply omitted — nothing is invented.
 */
import {
  createPdfBuffer,
  drawHeader,
  drawOrderMeta,
  drawPartyBlock,
  consigneeLines,
  exporterLines,
  fmtNum,
  MARGIN,
  CONTENT_WIDTH,
} from './pdfHelper.js';

export const generatePackingList = (order) =>
  createPdfBuffer((doc) => {
    let y = drawHeader(doc, 'PACKING LIST');
    y = drawOrderMeta(doc, order, y);
    y = drawPartyBlock(doc, 'Exporter', exporterLines(), y);
    y = drawPartyBlock(doc, 'Consignee', consigneeLines(order), y);

    const col = {
      item: MARGIN,
      qty: MARGIN + 235,
      packaging: MARGIN + 285,
      cartons: MARGIN + 375,
      weight: MARGIN + 435,
    };
    doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill('#0F172A');
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
    doc.text('Item', col.item + 4, y + 5);
    doc.text('Qty', col.qty, y + 5);
    doc.text('Packaging', col.packaging, y + 5);
    doc.text('Cartons', col.cartons, y + 5);
    doc.text('Gross Wt (kg)', col.weight, y + 5);
    y += 24;

    doc.font('Helvetica').fontSize(9).fillColor('#111827');
    for (const item of order.items || []) {
      if (y > 740) {
        doc.addPage();
        y = MARGIN;
      }
      const weightKg = item.snapshot?.weightKg;
      const pcsPerCarton = item.snapshot?.pcsPerCarton;
      const lineWeight =
        weightKg != null && item.quantity != null ? Number(weightKg) * Number(item.quantity) : null;
      const lineCartons =
        pcsPerCarton != null && item.quantity != null
          ? Math.ceil(Number(item.quantity) / Number(pcsPerCarton))
          : null;

      const name = item.productName || 'Item';
      const skuSuffix = item.sku ? ` (${item.sku})` : '';
      doc.text(`${name}${skuSuffix}`, col.item + 4, y, { width: 225 });
      doc.text(String(item.quantity ?? 0), col.qty, y);
      doc.text(String(item.packaging || ''), col.packaging, y, { width: 85 });
      doc.text(lineCartons != null ? String(lineCartons) : '—', col.cartons, y);
      doc.text(lineWeight != null ? fmtNum(lineWeight) : '—', col.weight, y);
      y += 15;

      const specBits = [item.size, item.finish, item.color, item.brand]
        .filter((v) => v && v !== 'Standard')
        .join(' · ');
      const extra = [specBits, item.customMarking ? `Marking: ${item.customMarking}` : '']
        .filter(Boolean)
        .join('   ');
      if (extra) {
        doc.fontSize(8).fillColor('#475569').text(extra, col.item + 4, y, { width: 400 });
        doc.fontSize(9).fillColor('#111827');
        y += 12;
      }
    }

    y += 10;
    doc.fontSize(10).font('Helvetica');
    doc.text(`Total Quantity: ${order.totalQuantity ?? 0}`, MARGIN, y);
    y += 14;
    if (Number(order.estimatedCartons) > 0) {
      doc.text(`Total Cartons: ${order.estimatedCartons}`, MARGIN, y);
      y += 14;
    }
    if (Number(order.estimatedWeightKg) > 0) {
      doc.text(`Total Gross Weight: ${fmtNum(order.estimatedWeightKg)} kg`, MARGIN, y);
      y += 14;
    }
    if (order.shippingMarks) {
      y += 6;
      doc.font('Helvetica-Bold').text('Shipping Marks:', MARGIN, y);
      y += 14;
      doc.font('Helvetica').text(String(order.shippingMarks), MARGIN, y, { width: CONTENT_WIDTH });
    }
  });

export default generatePackingList;
