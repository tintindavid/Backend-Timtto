'use strict';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

/**
 * Middleware para verificar si el usuario es superAdmin
 * SuperAdmin no tiene tenantId o tiene tenantId = 'superadmin'
 */
export function requireSuperAdmin(req, res, next) {
  try {
    // Verificar si existe usuario autenticado
    if (!req.user) {
      return next(new ApiError(401, 'No autenticado', 'NOT_AUTHENTICATED'));
    }

    // SuperAdmin no debe tener tenantId o debe tener 'superadmin' como tenantId
    const isSuperAdmin = !req.user.tenantId || 
                        req.user.tenantId === 'superadmin' || 
                        req.user.tenantId === 'SUPERADMIN' ||
                        req.user.role === 'superadmin';

    if (!isSuperAdmin) {
      logger.warn('Acceso denegado a ruta de superAdmin', { 
        userId: req.user._id,
        tenantId: req.user.tenantId 
      });
      return next(new ApiError(403, 'Acceso denegado. Se requieren permisos de SuperAdmin', 'FORBIDDEN'));
    }

    logger.info('SuperAdmin autenticado correctamente', { 
      userId: req.user._id 
    });
    
    next();
  } catch (err) {
    logger.error('Error en middleware requireSuperAdmin:', err);
    return next(new ApiError(500, 'Error verificando permisos de SuperAdmin', 'INTERNAL_ERROR'));
  }
}

/**
 * Middleware opcional: verifica si es superAdmin pero no bloquea si no lo es
 * Solo setea req.isSuperAdmin = true/false
 */
export function checkSuperAdmin(req, res, next) {
  try {
    if (!req.user) {
      req.isSuperAdmin = false;
      return next();
    }

    req.isSuperAdmin = !req.user.tenantId || 
                       req.user.tenantId === 'superadmin' || 
                       req.user.tenantId === 'SUPERADMIN' ||
                       req.user.role === 'superadmin';
    
    next();
  } catch (err) {
    req.isSuperAdmin = false;
    next();
  }
}
