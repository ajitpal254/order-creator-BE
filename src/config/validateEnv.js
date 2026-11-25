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
