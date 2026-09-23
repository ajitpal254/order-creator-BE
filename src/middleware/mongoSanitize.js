/**
 * MongoDB operator sanitizer middleware.
 * Strips $ and . prefixed operators from req.body, req.params, and req.query
 * by in-place mutation to prevent NoSQL injection.
 */
export function sanitizeMongoInput(req, res, next) {
  function sanitize(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete obj[key];
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitize(obj[key]);
      }
    }
  }

  try {
    if (req.body) sanitize(req.body);
    if (req.params) sanitize(req.params);
    if (req.query) sanitize(req.query);
  } catch (err) {
    console.warn('[Mongo Sanitize Warning]:', err.message);
  }
  next();
}
