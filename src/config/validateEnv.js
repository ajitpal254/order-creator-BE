import { z } from 'zod';

/**
 * Boot-time environment validation (QOL-03).
 *
 * Required in production — the variables the code cannot run without:
 *   - MONGODB_URI        (src/config/db.js)
 *   - JWT_SECRET         (src/utils/token.js — access tokens)
 *   - JWT_REFRESH_SECRET (src/utils/token.js — refresh tokens)
 *   - CLIENT_URL         (src/server.js CORS allowlist / auth redirects)
 *
 * Optional — missing values only ever produce a warning, never a boot
 * failure, so an over-strict schema can never take the live site down:
 *   - SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM / EMAIL_FROM
 *     (src/utils/emailService.js — mail is simulated when SMTP is unset;
 *      the sender address is actually read from EMAIL_FROM, SMTP_FROM is
 *      listed because it is provisioned alongside the other SMTP_* vars)
 *   - FIREBASE_PROJECT_ID (Google sign-in verification)
 *
 * In non-production environments missing required variables also only
 * warn — dev and the test suite must never break on env validation.
 */

export const REQUIRED_ENV_VARS = ['MONGODB_URI', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'CLIENT_URL'];

export const OPTIONAL_ENV_VARS = [
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'EMAIL_FROM',
  'FIREBASE_PROJECT_ID',
];

// v0.9 (FEAT-12/FEAT-14) optional, env-gated vars — documented here and
// in .env.example, deliberately NOT added to OPTIONAL_ENV_VARS above:
// that list's exact contents are asserted by tests/envValidation.test.js
// (a production boot with only the legacy optional vars set must report
// missingOptional=[] and emit no warning). These vars are warn-only in
// effect: SELLER_GSTIN (GST QR payload; falls back to invoice
// senderDetails.gstin), GSP_API_URL / GSP_API_KEY (IRN endpoint returns
// 501 GSP_NOT_CONFIGURED when unset), TURNSTILE_SECRET_KEY (RFQ
// verification skipped when unset).

const requiredSchema = z.object(
  Object.fromEntries(REQUIRED_ENV_VARS.map((name) => [name, z.string().min(1)]))
);

/**
 * Validate an environment map.
 *
 * @param {object} [options]
 * @param {object} [options.env]      Environment to check (defaults to process.env)
 * @param {string} [options.nodeEnv]  Defaults to env.NODE_ENV
 * @param {(msg: string) => void} [options.warn]  Warning sink (defaults to console.warn)
 * @returns {{ missingRequired: string[], missingOptional: string[], isProduction: boolean }}
 * @throws {Error} In production only, listing EVERY missing required variable.
 */
export const validateEnv = ({ env = process.env, nodeEnv = env.NODE_ENV, warn = (msg) => console.warn(msg) } = {}) => {
  const isProduction = nodeEnv === 'production';

  const parsed = requiredSchema.safeParse(env);
  const missingRequired = parsed.success
    ? []
    : [...new Set((parsed.error.issues ?? []).map((issue) => issue.path.join('.')).filter(Boolean))];

  const missingOptional = OPTIONAL_ENV_VARS.filter((name) => !env[name]);

  if (missingOptional.length > 0) {
    warn(
      `[Env] Optional environment variables not set (related features are disabled or simulated): ${missingOptional.join(', ')}`
    );
  }

  if (missingRequired.length > 0) {
    const message = `Missing required environment variables: ${missingRequired.join(', ')}`;
    if (isProduction) {
      throw new Error(message);
    }
    warn(`[Env] ${message} (continuing because NODE_ENV is not production)`);
  }

  return { missingRequired, missingOptional, isProduction };
};
