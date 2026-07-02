import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

/**
 * requireRole — factory middleware that grants access only when req.user.role
 * is included in the provided list.
 *
 * Usage:
 *   router.put('/my-tenant', authenticate, requireRole('admin'), controller.update);
 *   router.get('/admin', authenticate, requireRole('admin', 'superadmin'), controller.get);
 */
export function requireRole(...roles) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) {
      return next(new ApiError(401, 'No autenticado', 'NOT_AUTHENTICATED'));
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('requireRole: access denied', {
        userId: req.user._id || req.user.userId,
        role: req.user.role,
        requiredRoles: roles,
      });
      return next(
        new ApiError(403, 'Acceso denegado. No tienes permisos suficientes', 'FORBIDDEN'),
      );
    }

    return next();
  };
}
