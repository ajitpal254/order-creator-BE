import { logger } from '../utils/logger.js';
import { captureException } from '../utils/sentry.js';

/**
 * Global error handler (SEC-05).
 *
 * - CORS rejections surface as 403 with a generic message (they are a
 *   client/origin problem, not a server fault, and the internal message
 *   names the rejected origin).
 * - 5xx errors in production return a generic "Internal Server Error"
 *   plus the requestId — internal error details must not leak to clients.
 * - Intentional 4xx messages stay as-is in every environment.
 * - Non-production behaviour stays readable (real message is returned).
 */
export const isCorsError = (err) =>
  typeof err?.message === 'string' && err.message.startsWith('CORS policy violation');

export const globalErrorHandler = (err, req, res, next) => {
  // QOL-06: forward to Sentry only when it was initialised (SENTRY_DSN set).
  captureException(err);
  logger.error('Unhandled Global Error', {
    requestId: req.id,
    error: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  if (isCorsError(err)) {
    return res.status(403).json({
      success: false,
      message: 'Origin not authorized',
      requestId: req.id,
    });
  }

  const status = err.status || 500;
  const isServerError = status >= 500;
  const message =
    isServerError && process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  return res.status(status).json({
    success: false,
    message,
    requestId: req.id,
  });
};
