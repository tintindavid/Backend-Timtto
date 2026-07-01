import { ApiError } from '../utils/apiError.util.js';

/**
 * requireTenantMatch — allows access only when:
 *   (a) req.user.tenantId === req.params.id (own tenant), OR
 *   (b) req.user.role === 'superadmin' (platform operator).
 *
 * Used on legacy `/api/v1/tenants/:id` GET and PUT during the deprecation sunset.
 */
export function requireTenantMatch(req, res, next) {
  if (!req.user) {
    return next(new ApiError(401, 'No autenticado', 'NOT_AUTHENTICATED'));
  }

  if (req.user.role === 'superadmin') {
    return next();
  }

  if (req.user.tenantId === req.params.id) {
    return next();
  }

  return next(new ApiError(403, 'Acceso denegado a tenant ajeno', 'FORBIDDEN_CROSS_TENANT'));
}
