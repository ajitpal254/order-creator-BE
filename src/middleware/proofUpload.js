import multer from 'multer';
import crypto from 'crypto';
import { sniffImageType, imageTypeForMime, IMAGE_TYPES } from '../utils/imageSniff.js';
import { storage } from '../services/storage.js';

// FEAT-03 (v0.6): payment-proof uploads. Dedicated middleware — the
// existing image-only upload (src/middleware/upload.js) is untouched.
// Accepts JPEG/PNG/WebP (same magic-byte sniffing) plus PDF (%PDF-).
export const INVALID_PROOF_MESSAGE =
  'Invalid file type. Only JPEG, PNG, WebP images and PDF files are allowed.';

export const sniffProofType = (buffer) => {
  if (!buffer || buffer.length < 4) return null;
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  return sniffImageType(b);
};

const PROOF_TYPES = {
  ...IMAGE_TYPES,
  pdf: { ext: '.pdf', mime: 'application/pdf' },
};

const declaredTypeForMime = (mimetype) => {
  if ((mimetype || '').toLowerCase() === 'application/pdf') return 'pdf';
  return imageTypeForMime(mimetype);
};

const sniffingStorage = {
  _handleFile(req, file, cb) {
    const chunks = [];
    file.stream.on('data', (chunk) => chunks.push(chunk));
    file.stream.on('error', cb);
    file.stream.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const sniffed = sniffProofType(buffer);
        if (!sniffed) return cb(new Error(INVALID_PROOF_MESSAGE));
        const declared = declaredTypeForMime(file.mimetype);
        if (declared && declared !== sniffed) return cb(new Error(INVALID_PROOF_MESSAGE));
        const { ext, mime } = PROOF_TYPES[sniffed];
        const filename = `pay_${Date.now()}_${crypto.randomBytes(16).toString('hex')}${ext}`;
        const stored = await storage.put(filename, buffer, mime);
        cb(null, {
          filename,
          path: stored.path,
          size: buffer.length,
          buffer,
          storageUrl: stored.url,
          sniffedType: sniffed,
        });
      } catch (err) {
        cb(err);
      }
    });
  },
  async _removeFile(req, file, cb) {
    try {
      if (file.filename) await storage.delete(file.filename);
    } catch { /* best-effort */ }
    cb(null);
  },
};

export const uploadProof = multer({
  storage: sniffingStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});
