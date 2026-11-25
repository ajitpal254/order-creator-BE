import crypto from 'crypto';

// RFC 4648 base32 (no padding on encode; decode tolerates padding/spaces).
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32Encode = (buffer) => {
  const bytes = Buffer.from(buffer);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
};

export const base32Decode = (input) => {
  const clean = String(input).toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
};

export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

export const totp = (secret, { timestamp = Date.now(), digits = 6 } = {}) => {
  const counter = Math.floor(timestamp / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(binary % mod).padStart(digits, '0');
};

export const verifyTotp = (secret, code, { window = 1, timestamp = Date.now(), digits = 6 } = {}) => {
  if (!secret || code == null) return false;
  const supplied = String(code).trim();
  if (!/^\d+$/.test(supplied) || supplied.length !== digits) return false;
  const suppliedBuf = Buffer.from(supplied);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = totp(secret, { timestamp: timestamp + offset * 30 * 1000, digits });
    const expectedBuf = Buffer.from(expected);
    if (expectedBuf.length === suppliedBuf.length && crypto.timingSafeEqual(expectedBuf, suppliedBuf)) {
      return true;
    }
  }
  return false;
};

export const buildOtpAuthUri = ({ secret, account, issuer = 'H.A. Overseas' } = {}) => {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};

export const generateBackupCodes = (count = 8) => {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const hex = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    codes.push(`${hex.slice(0, 5)}-${hex.slice(5)}`);
  }
  return codes;
};

export const normalizeBackupCode = (code) =>
  String(code ?? '').replace(/[\s-]/g, '').toUpperCase();

export const hashBackupCode = (code) =>
  crypto.createHash('sha256').update(normalizeBackupCode(code)).digest('hex');
