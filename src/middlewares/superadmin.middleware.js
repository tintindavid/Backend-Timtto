import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

/**
 * requireSuperAdmin — blocks requests from non-superadmin users.
 * Identification is based exclusively on req.user.role === 'superadmin'.
 * Magic strings (tenantId === 'superadmin'|'SUPERADMIN') are no longer recognized.
 */
export function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return next(new ApiError(401, 'No autenticado', 'NOT_AUTHENTICATED'));
  }

  if (req.user.role !== 'superadmin') {
    logger.warn('requireSuperAdmin: access denied', {
      userId: req.user._id || req.user.userId,
      role: req.user.role,
    });
    return next(new ApiError(403, 'Acceso denegado. Se requieren permisos de SuperAdmin', 'FORBIDDEN'));
  }

  return next();
}

/**
 * checkSuperAdmin — non-blocking flag middleware.
 * Sets req.isSuperAdmin = true when role === 'superadmin', false otherwise.
 */
export function checkSuperAdmin(req, res, next) {
  req.isSuperAdmin = req.user?.role === 'superadmin';
  return next();
}
