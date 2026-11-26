import mongoose from 'mongoose';
import crypto from 'crypto';

// FEAT-15 (v1.0): Public API keys. Only the SHA-256 hash of the
// plaintext key is stored; the plaintext (`hao_` + 32 random bytes hex)
// is returned exactly once at creation time and can never be recovered.
export const API_KEY_SCOPES = ['products:read', 'orders:read', 'orders:write'];

export const generateApiKeyPlaintext = () => `hao_${crypto.randomBytes(32).toString('hex')}`;

export const hashApiKey = (plaintext) =>
  crypto.createHash('sha256').update(String(plaintext)).digest('hex');

const apiKeySchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, default: 'API Key', trim: true },
    keyHash: { type: String, required: true, unique: true },
    // First 8 chars of the plaintext key — display/identification only.
    prefix: { type: String, required: true },
    scopes: {
      type: [{ type: String, enum: API_KEY_SCOPES }],
      default: [],
    },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const ApiKey = mongoose.model('ApiKey', apiKeySchema);
