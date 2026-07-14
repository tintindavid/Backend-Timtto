'use strict';

import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

/**
 * Guards a route by requiring the caller's role to include `permission`.
 *
 * Assumes `authenticate` middleware already hydrated req.user.permissions
 * (a string[] pulled from the caller's role in a single Mongo lookup). This
 * middleware itself performs no I/O — it's a pure array check.
 *
 * superadmin bypass: platform-role users (req.user.role === 'superadmin') are
 * platform operators; they never touch tenant business routes in practice, but
 * if they do we let them through so read-only view-as flows keep working.
 * Tenant isolation is still enforced downstream by tenantResolver.
 *
 * @param {string} permission - e.g. 'ots:create'
 */
export function authorize(permission) {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) {
      return next(new ApiError(401, 'No autenticado', 'NOT_AUTHENTICATED'));
    }

    if (user.role === 'superadmin') return next();

    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    if (!permissions.includes(permission)) {
      logger.warn(
        `[RBAC] DENIED tenantId=${user.tenantId} userId=${user.userId} permission=${permission}`,
      );
      return next(new ApiError(403, 'Permisos insuficientes', 'FORBIDDEN'));
    }

    return next();
  };
}
