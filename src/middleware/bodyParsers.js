import express from 'express';

/**
 * Body size limits (SEC-13).
 *
 * The default JSON / urlencoded limit is 100kb — every API route in
 * this app takes small JSON payloads (orders, invoices, products,
 * auth); nothing legitimately sends a large JSON body (checked: no
 * base64/data-URI payloads anywhere in src/).
 *
 * File uploads do NOT go through these parsers: product images are
 * multipart/form-data handled by multer (src/middleware/upload.js),
 * which has its own 5MB per-file limit, so no route needs a larger
 * scoped parser. Oversized JSON bodies fail with 413
 * (entity.too.large), surfaced by the global error handler.
 */
export const DEFAULT_BODY_LIMIT = '100kb';

export const jsonBodyParser = express.json({ limit: DEFAULT_BODY_LIMIT });
export const urlencodedBodyParser = express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT });
