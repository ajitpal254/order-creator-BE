/**
 * Optional Sentry integration (QOL-06).
 *
 * Sentry is ENV-GATED: it is only initialised when SENTRY_DSN is set.
 * The SDK is loaded via dynamic import so that, when the variable is
 * unset, there is zero behaviour change (and the SDK is never loaded).
 */
import { logger } from './logger.js';

let sentryClient = null;
let initialised = false;

/**
 * Initialise Sentry if (and only if) SENTRY_DSN is configured.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<boolean>} true when Sentry was initialised.
 */
export const initSentry = async (env = process.env) => {
  if (initialised) return true;
  const dsn = env.SENTRY_DSN;
  if (!dsn) return false;
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({ dsn, environment: env.NODE_ENV || 'development' });
    sentryClient = Sentry;
    initialised = true;
    logger.info('Sentry initialised');
    return true;
  } catch (err) {
    // Never let an observability failure take the server down.
    logger.error('Failed to initialise Sentry', { error: err.message });
    return false;
  }
};

/** Whether Sentry has been initialised in this process. */
export const isSentryInitialised = () => initialised;

/** Forward an exception to Sentry when initialised; no-op otherwise. */
export const captureException = (err) => {
  if (initialised && sentryClient) {
    sentryClient.captureException(err);
  }
};
