'use strict';

import { Role } from '../models/role.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

export function authorize(permission) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return next(new ApiError(401, 'No autenticado', 'NOT_AUTHENTICATED'));
      }

      if (!user.roleId) {
        return next(new ApiError(403, 'No hay rol asignado', 'NO_ROLE_ASSIGNED'));
      }

      const roleQuery = Role.findOne({ _id: user.roleId, tenantId: user.tenantId, isDeleted: false });
      const role = typeof roleQuery?.lean === 'function' ? await roleQuery.lean() : await roleQuery;
      if (!role || !Array.isArray(role.permissions) || !role.permissions.includes(permission)) {
        logger.warn(`[RBAC] DENIED tenantId=${user.tenantId} userId=${user.userId} permission=${permission}`);
        return next(new ApiError(403, 'Permisos insuficientes', 'FORBIDDEN'));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}