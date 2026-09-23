/**
 * Structured Logger utility
 * Provides leveled logging with timestamp and optional request correlation ID
 */

const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

const formatMessage = (level, message, meta = {}) => {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
};

export const logger = {
  info: (message, meta = {}) => {
    console.log(formatMessage(LOG_LEVELS.INFO, message, meta));
  },
  warn: (message, meta = {}) => {
    console.warn(formatMessage(LOG_LEVELS.WARN, message, meta));
  },
  error: (message, meta = {}) => {
    console.error(formatMessage(LOG_LEVELS.ERROR, message, meta));
  },
  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(formatMessage(LOG_LEVELS.DEBUG, message, meta));
    }
  },
};
