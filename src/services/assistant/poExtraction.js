import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import { Product } from '../../models/Product.js';
import { createSearchRegex } from '../../utils/escapeRegExp.js';

/**
 * PO extraction (FEAT-16 Stage 4a, v1.0) — 100% LOCAL parsing.
 * No external calls: PDF text via pdf-parse v2 (class API:
 * `new PDFParse({ data })` -> `getText()`), spreadsheets via xlsx
 * (SheetJS), CSV via the minimal quote-aware parser below.
 *
 * Output line shape: { name, quantity, unitPrice|null }.
 *
 * Parser limits (pragmatic by design):
 * - PDF: only lines of the form "<name> <quantity> [<unit price>]"
 *   are recognised — the quantity is a trailing integer and the
 *   optional price a trailing decimal (e.g. "Claw Hammer 100 12.50").
 *   Multi-column table layouts, wrapped names, "100 pcs" suffixes and
 *   scanned/image PDFs (no embedded text) are NOT parsed.
 * - XLSX: first sheet only. A header row containing a name/description
 *   column and a qty/quantity column (case-insensitive) is detected;
 *   otherwise the first two columns are taken as name + quantity and
 *   an optional third numeric column as unit price.
 * - CSV: same header detection as XLSX; without a header the columns
 *   are name, quantity[, unit price]. Quoted fields with commas and
 *   escaped quotes ("") are supported; embedded newlines in quotes
 *   are not.
 */

const NAME_HEADERS = ['name', 'description', 'product', 'item'];
const QTY_HEADERS = ['qty', 'quantity'];
const PRICE_HEADERS = ['price', 'unit price', 'rate', 'unitprice'];

const findHeaderIndexes = (cells) => {
  const lowered = cells.map((c) => String(c ?? '').trim().toLowerCase());
  const nameIdx = lowered.findIndex((c) => NAME_HEADERS.some((h) => c.includes(h)));
  const qtyIdx = lowered.findIndex((c) => QTY_HEADERS.some((h) => c === h || c.includes(h)));
  const priceIdx = lowered.findIndex((c) => PRICE_HEADERS.some((h) => c.includes(h)));
  return { nameIdx, qtyIdx, priceIdx, isHeader: nameIdx >= 0 && qtyIdx >= 0 };
};

const toQuantity = (value) => {
  const n = parseInt(String(value ?? '').replace(/,/g, '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const toPrice = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const rowsToLines = (rows) => {
  const lines = [];
  let indexes = null;
  let startRow = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const found = findHeaderIndexes(rows[i] || []);
    if (found.isHeader) {
      indexes = found;
      startRow = i + 1;
      break;
    }
  }
  const nameIdx = indexes ? indexes.nameIdx : 0;
  const qtyIdx = indexes ? indexes.qtyIdx : 1;
  const priceIdx = indexes ? indexes.priceIdx : 2;
  for (let i = startRow; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const name = String(row[nameIdx] ?? '').trim();
    const quantity = toQuantity(row[qtyIdx]);
    if (!name || quantity === null) continue;
    lines.push({ name, quantity, unitPrice: toPrice(row[priceIdx]) });
  }
  return lines;
};

// ── CSV: minimal quote-aware parser (no CSV reader exists in the
// codebase — reports only WRITE csv). Supports quoted fields, commas
// inside quotes and "" escapes; no embedded newlines inside quotes.
export const parseCsvRows = (text) => {
  const rows = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < rawLine.length; i += 1) {
      const ch = rawLine[i];
      if (inQuotes) {
        if (ch === '"') {
          if (rawLine[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current);
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
};

export const parseCsvPo = (text) => rowsToLines(parseCsvRows(text));

export const parseXlsxPo = (buffer) => {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  });
  return rowsToLines(rows);
};

// PDF line grammar: "<name> <qty:int> [<price:decimal>]".
const PDF_LINE_RE = /^(.+?)\s+(\d[\d,]*)(?:\s+(\d[\d,]*\.\d+))?\s*$/;

export const parsePdfTextPo = (text) => {
  const lines = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) continue; // pdf-parse page footer
    if (/^(product|description|item)\b.*\b(qty|quantity)\b/i.test(line)) continue; // header row
    const match = line.match(PDF_LINE_RE);
    if (!match) continue;
    const name = match[1].trim();
    if (!/[a-zA-Z]/.test(name)) continue;
    const quantity = toQuantity(match[2]);
    if (quantity === null) continue;
    lines.push({ name, quantity, unitPrice: toPrice(match[3]) });
  }
  return lines;
};

export const parsePdfPo = async (buffer) => {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return parsePdfTextPo(result?.text || '');
  } finally {
    if (typeof parser.destroy === 'function') {
      try {
        await parser.destroy();
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
};

/**
 * Extract raw PO lines from an uploaded file buffer. Type is decided
 * by filename extension first, then mimetype. Throws an Error with
 * `status = 400` for unsupported types.
 */
export const extractPoLines = async ({ buffer, filename = '', mimetype = '' }) => {
  const ext = String(filename).toLowerCase().split('.').pop();
  if (ext === 'pdf' || mimetype === 'application/pdf') return parsePdfPo(buffer);
  if (ext === 'xlsx' || ext === 'xls' || String(mimetype).includes('spreadsheet')) {
    return parseXlsxPo(buffer);
  }
  if (ext === 'csv' || mimetype === 'text/csv' || mimetype === 'application/csv') {
    return parseCsvPo(buffer.toString('utf8'));
  }
  const err = new Error('Unsupported file type. Please upload a .pdf, .xlsx or .csv purchase order.');
  err.status = 400;
  throw err;
};

/**
 * Match extracted lines against the catalog. Exact (case-insensitive)
 * name or SKU match first -> confidence 'exact'; then a contains
 * match on name/SKU -> 'partial'; otherwise unmatched (productId null).
 */
export const matchPoLines = async (lines) => {
  const enriched = [];
  const all = lines.length
    ? await Product.find({ isActive: true }).select('name sku').lean()
    : [];
  for (const line of lines) {
    const name = String(line.name || '').trim();
    let product = null;
    let confidence = null;
    if (name) {
      const lower = name.toLowerCase();
      product =
        all.find((p) => p.name.toLowerCase() === lower || p.sku.toLowerCase() === lower) || null;
      if (product) {
        confidence = 'exact';
      } else {
        const regex = createSearchRegex(name);
        const candidates = await Product.find({
          isActive: true,
          $or: [{ name: regex }, { sku: regex }],
        })
          .select('name sku')
          .limit(5)
          .lean();
        const contains = all.find(
          (p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase())
        );
        product = candidates[0] || contains || null;
        if (product) confidence = 'partial';
      }
    }
    enriched.push({
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? null,
      productId: product ? product._id.toString() : null,
      matched: Boolean(product),
      ...(confidence ? { confidence } : {}),
    });
  }
  return enriched;
};
