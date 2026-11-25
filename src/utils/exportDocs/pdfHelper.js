/**
 * Shared PDF plumbing for the export document generators (FEAT-08, v0.8).
 *
 * These generators are STANDALONE: they render export/shipping
 * artefacts from ORDER data only and deliberately do NOT import or
 * reuse src/utils/pdfGenerator.js (the invoice/order PDF generator).
 * Totals are always rendered exactly as stored on the order — nothing
 * here recomputes pricing or tax.
 */
import PDFDocument from 'pdfkit';

export const MARGIN = 40;
export const PAGE_WIDTH = 595.28; // A4
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
};

export const fmtMoney = (amount, currency = 'USD') => {
  const num = Number(amount);
  if (!Number.isFinite(num)) return `0.00 ${currency}`;
  return `${num.toFixed(2)} ${currency}`;
};

export const fmtNum = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number.isInteger(num) ? String(num) : String(parseFloat(num.toFixed(2)));
};

/**
 * Exporter profile from env (blank-safe): only fields that are set are
 * rendered. Country defaults to 'Canada' when EXPORTER_COUNTRY is unset.
 */
export const getExporterProfile = (env = process.env) => ({
  name: (env.EXPORTER_NAME || '').trim(),
  address: (env.EXPORTER_ADDRESS || '').trim(),
  country: (env.EXPORTER_COUNTRY || '').trim() || 'Canada',
});

/** Consignee (buyer) block lines from the order's stored customer details. */
export const consigneeLines = (order) => {
  const cd = order?.customerDetails || {};
  return [cd.customerName, cd.businessName, cd.address, cd.country, cd.email, cd.phoneNumber]
    .filter((v) => v != null && String(v).trim() !== '')
    .map(String);
};

/** Exporter block lines from the env profile (only what's set). */
export const exporterLines = (env = process.env) => {
  const profile = getExporterProfile(env);
  return [profile.name, profile.address, profile.country].filter(
    (v) => v != null && String(v).trim() !== ''
  );
};

/**
 * Run a builder against a fresh PDFDocument and resolve with the PDF
 * buffer, ready to be stored through the storage service.
 *
 * @param {(doc: PDFKit.PDFDocument) => void} build
 * @param {object} [docOptions] extra PDFDocument options (e.g. size/layout)
 * @returns {Promise<Buffer>}
 */
export const createPdfBuffer = (build, docOptions = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: MARGIN, size: 'A4', ...docOptions });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);
      build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

/** Dark banner header used by the sheet-style export documents. */
export const drawHeader = (doc, title) => {
  doc.rect(MARGIN, MARGIN, CONTENT_WIDTH, 68).fill('#0F172A');
  doc.rect(MARGIN, MARGIN + 68, CONTENT_WIDTH, 3).fill('#D97706');
  doc
    .fillColor('#FFFFFF')
    .fontSize(18)
    .font('Helvetica-Bold')
    .text('H.A. OVERSEAS', MARGIN + 16, MARGIN + 12);
  doc
    .fontSize(8.5)
    .font('Helvetica')
    .fillColor('#94A3B8')
    .text('Manufacturers & Exporters of Precision Hand Tools & Hardware', MARGIN + 16, MARGIN + 33);
  doc
    .fillColor('#0F172A')
    .fontSize(17)
    .font('Helvetica-Bold')
    .text(title, MARGIN, MARGIN + 86);
  return MARGIN + 116;
};

/** Labelled party block; renders only the lines that exist. Returns next y. */
export const drawPartyBlock = (doc, label, lines, y) => {
  doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text(label, MARGIN, y);
  y += 15;
  doc.fontSize(10).font('Helvetica').fillColor('#111827');
  for (const line of lines) {
    doc.text(String(line), MARGIN, y, { width: CONTENT_WIDTH });
    y += 13;
  }
  return y + 8;
};

/** Order meta lines (number / date / incoterm). Returns next y. */
export const drawOrderMeta = (doc, order, y) => {
  doc.fontSize(10).font('Helvetica').fillColor('#111827');
  doc.text(`Order No: ${order.orderNumber || ''}`, MARGIN, y);
  y += 14;
  doc.text(`Date: ${fmtDate(order.updatedAt || order.createdAt)}`, MARGIN, y);
  y += 14;
  doc.text(
    `Incoterm: ${order.incoterm || 'FOB'}    Currency: ${order.currency || 'USD'}`,
    MARGIN,
    y
  );
  return y + 22;
};
