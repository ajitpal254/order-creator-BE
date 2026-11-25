/**
 * redact.js (FEAT-16 Stage 2, v0.7)
 * Privacy redaction applied to EVERY payload (notably tool results)
 * before it leaves the process for a third-party LLM provider.
 * Keys matching /phone|email|address|mobile|tel/i at any depth have
 * their values replaced with '[REDACTED]'. The input is never mutated.
 */
const SENSITIVE_KEY = /phone|email|address|mobile|tel/i;

export const REDACTED = '[REDACTED]';

export const redactForProvider = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => redactForProvider(item));
  }
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactForProvider(val);
      }
    }
    return out;
  }
  return value;
};
