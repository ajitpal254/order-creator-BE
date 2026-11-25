import multer from 'multer';
import crypto from 'crypto';
import { sniffImageType, imageTypeForMime, IMAGE_TYPES } from '../utils/imageSniff.js';
import { storage } from '../services/storage.js';

// SEC-09 (v0.3): uploads are validated by their actual bytes, never by
// the client-supplied filename or Content-Type, and persisted through
// the storage service (src/services/storage.js) instead of straight to
// disk. The error message is unchanged from the old mimetype
// fileFilter so clients see the same rejection.
export const INVALID_IMAGE_MESSAGE =
  'Invalid file type. Only JPEG, PNG, and WebP images are allowed.';

/**
 * Multer storage engine: buffers the incoming file (multer enforces the
 * 5MB limit), sniffs its magic bytes, rejects non-images and
 * declared/actual type mismatches, then stores it under a generated
 * name whose extension comes from the SNIFFED type.
 */
const sniffingStorage = {
  _handleFile(req, file, cb) {
    const chunks = [];
    file.stream.on('data', (chunk) => chunks.push(chunk));
    file.stream.on('error', cb);
    file.stream.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);

        const sniffed = sniffImageType(buffer);
        if (!sniffed) {
          return cb(new Error(INVALID_IMAGE_MESSAGE));
        }

        // A declared image type that disagrees with the bytes (e.g. PNG
        // content claiming to be JPEG) is rejected, not silently kept.
        const declared = imageTypeForMime(file.mimetype);
        if (declared && declared !== sniffed) {
          return cb(new Error(INVALID_IMAGE_MESSAGE));
        }

        const { ext, mime } = IMAGE_TYPES[sniffed];
        const filename = `prod_${Date.now()}_${crypto.randomBytes(16).toString('hex')}${ext}`;
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
    } catch {
      // Removal is best-effort cleanup; never fail the request over it.
    }
    cb(null);
  },
};

export const upload = multer({
  storage: sniffingStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});
