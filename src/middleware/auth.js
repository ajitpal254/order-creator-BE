import { verifyAccessToken } from '../utils/token.js';
import { User } from '../models/User.js';

export const protect = async (req, res, next) => {
  try {
    let token = null;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token missing. Access denied.',
      });
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session token: User no longer exists.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact H.A. Overseas support.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired session token.',
      error: error.message,
    });
  }
};

/**
 * Middleware to restrict access to specific user roles
 * @param  {...string} roles - Allowed roles (e.g. 'admin', 'sales_manager', etc.)
 */
export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    // super_admin always passes
    if (req.user.role === 'super_admin' || req.user.role === 'admin') {
      return next();
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Role "${req.user.role}" does not have required permissions.`,
      });
    }

    next();
  };
};

export const adminOnly = (req, res, next) => {
  return authorizeRoles('admin', 'super_admin')(req, res, next);
};
