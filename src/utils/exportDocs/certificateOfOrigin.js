/**
 * Certificate of Origin data sheet generator (FEAT-08, v0.8).
 *
 * A data sheet (not a certified/legal certificate): goods descriptions
 * come from the order items; the origin country and exporter profile
 * come from env — EXPORTER_NAME / EXPORTER_ADDRESS / EXPORTER_COUNTRY
 * (country defaults to 'Canada'). Blank profile fields are omitted.
 */
import {
  createPdfBuffer,
  drawHeader,
  drawOrderMeta,
  drawPartyBlock,
  consigneeLines,
  exporterLines,
  getExporterProfile,
  MARGIN,
  CONTENT_WIDTH,
} from './pdfHelper.js';

export const generateCertificateOfOrigin = (order, env = process.env) =>
  createPdfBuffer((doc) => {
    const profile = getExporterProfile(env);
    let y = drawHeader(doc, 'CERTIFICATE OF ORIGIN — DATA SHEET');
    y = drawOrderMeta(doc, order, y);
    y = drawPartyBlock(doc, 'Exporter', exporterLines(env), y);
    y = drawPartyBlock(doc, 'Consignee', consigneeLines(order), y);

    doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('Country of Origin', MARGIN, y);
    y += 15;
    doc.fontSize(10).font('Helvetica').fillColor('#111827');
    doc.text(profile.country, MARGIN, y);
    y += 22;

    doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('Goods', MARGIN, y);
    y += 16;

    const col = { item: MARGIN, qty: MARGIN + 380 };
    doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill('#0F172A');
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
    doc.text('Description of Goods', col.item + 4, y + 5);
    doc.text('Qty', col.qty, y + 5);
    y += 24;

    doc.font('Helvetica').fontSize(9).fillColor('#111827');
    for (const item of order.items || []) {
      if (y > 740) {
        doc.addPage();
        y = MARGIN;
      }
      const bits = [item.productName || 'Item', item.sku ? `(${item.sku})` : '']
        .filter(Boolean)
        .join(' ');
      const spec = [item.size, item.finish, item.color, item.brand]
        .filter((v) => v && v !== 'Standard')
        .join(' · ');
      doc.text(spec ? `${bits} — ${spec}` : bits, col.item + 4, y, { width: 360 });
      doc.text(String(item.quantity ?? 0), col.qty, y);
      y += 16;
    }

    y += 16;
    doc
      .fontSize(9)
      .fillColor('#111827')
      .text(
        `The undersigned exporter declares that the goods described above originate in ${profile.country}.`,
        MARGIN,
        y,
        { width: CONTENT_WIDTH }
      );
    y += 40;
    doc.text('Signature: ______________________________', MARGIN, y);
    y += 20;
    doc.text('Name / Title: ___________________________', MARGIN, y);
  });

export default generateCertificateOfOrigin;
