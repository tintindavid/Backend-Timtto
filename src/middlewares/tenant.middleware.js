'use strict';
import { ApiError } from '../utils/apiError.util.js';
import { Tenant } from '../models/tenant.model.js';
import { logger } from '../config/logger.config.js';

/**
 * Resolve tenantId for the request and validate it exists.
 * Priority: header 'x-tenant-id' -> req.user?.tenantId -> body.tenantId
 * Sets req.tenantId when found.
 */
export async function tenantResolver(req, res, next) {
  try {
    const header = req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'];
    let tenantId = null;
    if (header && typeof header === 'string' && header.trim()) {
      tenantId = header.trim();
    } else if (req.user && req.user.tenantId) {
      tenantId = req.user.tenantId;
    } else if (req.body && req.body.tenantId) {
      tenantId = req.body.tenantId;
    }

    if (!tenantId) {
      logger.debug && logger.debug('tenantResolver: no tenantId provided');
      return next();
    }

    // allow tenant creation endpoint to pass without existing tenant
    if (req.method === 'POST' && req.path === '/api/v1/tenants') {
      req.tenantId = tenantId;
      return next();
    }

    // Búsqueda case-insensitive
    logger.info('tenantResolver: resolving tenantId', { tenantId });
    const exists = await Tenant.exists({
      tenantId: { $regex: new RegExp(`^${tenantId}$`, 'i') },
      isDeleted: false,
    });
    
    logger.info('tenantResolver: exists?', { tenantId, exists: Boolean(exists) });
    if (!exists) return next(new ApiError(404, 'Tenant not found', 'TENANT_NOT_FOUND'));
    req.tenantId = tenantId;
    return next();
  } catch (err) {
    return next(new ApiError(400, 'Tenant resolution failed', 'TENANT_RESOLUTION_FAILED'));
  }
}
