/**
 * Structured Logger utility (QOL-06: backed by pino).
 *
 * The exported interface is unchanged from the original hand-rolled
 * logger — { info, warn, error, debug }(message, meta) — so existing
 * call sites keep working. Log lines are JSON with the same field
 * names as before: `timestamp` (ISO), `level` (uppercase string),
 * `message`, plus any meta fields merged in (including `requestId`
 * when call sites pass it).
 */
import pino from 'pino';

const pinoOptions = {
  level: 'debug',
  messageKey: 'message',
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
};

/**
 * Create a logger with the standard interface. `destination` is an
 * optional writable stream (defaults to stdout via pino) — used by
 * tests to capture emitted lines.
 */
export const createLogger = (destination) => {
  const base = destination ? pino(pinoOptions, destination) : pino(pinoOptions);
  const wrap = (level) => (message, meta = {}) => {
    base[level](meta ?? {}, message);
  };
  return {
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    debug: (message, meta = {}) => {
      // Preserve the original behaviour: debug lines only outside production.
      if (process.env.NODE_ENV !== 'production') {
        base.debug(meta ?? {}, message);
      }
    },
    // Escape hatch for advanced pino usage / tests.
    pino: base,
  };
};

export const logger = createLogger();
