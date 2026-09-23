/**
 * Service-to-Service Internal Authentication Middleware
 * Scoped exclusively to internal machine-to-machine routes (e.g. /api/internal/*)
 */

export const requireInternalKey = (req, res, next) => {
  const internalKey = req.headers['x-internal-key'];
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    return res.status(500).json({
      success: false,
      message: 'Internal API Key is not configured on the server.',
    });
  }

  if (!internalKey || internalKey !== expectedKey) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid or missing X-Internal-Key header.',
    });
  }

  next();
};
