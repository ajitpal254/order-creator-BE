/**
 * imageSniff (SEC-09, v0.3)
 *
 * Hand-rolled magic-byte detection for the image formats the product
 * catalog accepts. The client-supplied filename and Content-Type are
 * NOT trusted anywhere in the upload path — the actual bytes decide
 * both acceptance and the stored file extension.
 *
 * Signatures:
 *  - JPEG: FF D8 FF
 *  - PNG:  89 50 4E 47 0D 0A 1A 0A  ("\x89PNG\r\n\x1a\n")
 *  - WebP: "RIFF" at 0..4 and "WEBP" at 8..12
 */

export const IMAGE_TYPES = {
  jpeg: { ext: '.jpg', mime: 'image/jpeg' },
  png: { ext: '.png', mime: 'image/png' },
  webp: { ext: '.webp', mime: 'image/webp' },
};

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {'jpeg'|'png'|'webp'|null} the sniffed type, or null when the
 *   bytes match none of the supported signatures (including too-short
 *   or empty input).
 */
export const sniffImageType = (buffer) => {
  if (!buffer || buffer.length < 3) return null;
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'png';
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }

  return null;
};

/**
 * Canonical sniffed type for a client-declared MIME type, or null when
 * the declared type is not one of the supported image types (e.g.
 * application/octet-stream). Used to detect a declared/actual mismatch:
 * PNG bytes claiming to be image/jpeg are rejected, not silently kept.
 *
 * @param {string} mimetype
 * @returns {'jpeg'|'png'|'webp'|null}
 */
export const imageTypeForMime = (mimetype) => {
  switch ((mimetype || '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
};
