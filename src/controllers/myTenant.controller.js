import { TenantService } from '../services/tenant.service.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';

/**
 * MyTenantController — scoped to the currently authenticated user's own tenant.
 *
 * GET  /api/v1/my-tenant  — any authenticated user can read their tenant.
 * PUT  /api/v1/my-tenant  — restricted to role='admin' (enforced by requireRole).
 * GET  /api/v1/my-tenant/capabilities — any authenticated user (no RBAC permission).
 *
 * tenantId is resolved from req.user.tenantId (JWT), never from req.body.
 */
export class MyTenantController {
  /**
   * GET /api/v1/my-tenant
   */
  static async get(req, res, next) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return next(new ApiError(400, 'No tenantId asociado al usuario', 'TENANT_MISSING'));
      }

      const tenant = await TenantService.getByTenantId(tenantId);
      return res.status(200).json(successResponse(tenant, 'Tenant recuperado'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/v1/my-tenant/capabilities
   * Effective tenant of the request: for a regular user it is the token's tenant (enforceTenantTokenMatch),
   * for a superadmin in view-as it is the viewed tenant, otherwise the platform sentinel.
   */
  static async getCapabilities(req, res, next) {
    try {
      const tenantId = req.tenantId || req.user?.tenantId;
      if (!tenantId) {
        return next(new ApiError(400, 'No tenantId asociado al usuario', 'TENANT_MISSING'));
      }

      const data = await TenantService.getCapabilities(String(tenantId).trim().toLowerCase());
      return res.status(200).json(successResponse(data, 'Capacidades recuperadas'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * PUT /api/v1/my-tenant
   * Only admin-role users reach here (requireRole enforces it in the route).
   * Supports optional logo upload (multipart/form-data).
   */
  static async update(req, res, next) {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        return next(new ApiError(400, 'No tenantId asociado al usuario', 'TENANT_MISSING'));
      }

      const updated = await TenantService.update(tenantId, req.body, req.file || null);
      return res.status(200).json(successResponse(updated, 'Tenant actualizado'));
    } catch (err) {
      return next(err);
    }
  }
}

export const myTenantController = MyTenantController;
