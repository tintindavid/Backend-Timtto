import { PlatformTenantService } from '../services/platformTenant.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

/**
 * PlatformTenantController — pure binding: req → service → res.
 * No business logic lives here.
 */
export class PlatformTenantController {
  /**
   * GET /api/v1/platform/tenants
   * Query: page, limit, status, plan, search, includeDeleted
   */
  static async list(req, res, next) {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        plan,
        search,
        includeDeleted,
      } = req.query;

      const result = await PlatformTenantService.list({
        page: Number(page),
        limit: Math.min(Number(limit), 100), // hard cap
        status,
        plan,
        search,
        includeDeleted: includeDeleted === 'true',
      });

      return res
        .status(200)
        .json(successResponse(result.data, 'Tenants recuperados', 200, result.pagination));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/v1/platform/tenants/:id
   */
  static async getById(req, res, next) {
    try {
      const result = await PlatformTenantService.getById(req.params.id);
      return res.status(200).json(successResponse(result, 'Tenant recuperado'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/v1/platform/tenants
   * Body validated by createTenantWithAdminSchema.
   * Optional logo file arrives via multipart on req.file.
   * Returns 201 with { tenant, admin, temporaryPassword }.
   */
  static async create(req, res, next) {
    try {
      const result = await PlatformTenantService.createWithAdmin(req.body, req.file || null);
      return res.status(201).json(successResponse(result, 'Tenant creado exitosamente'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * PUT /api/v1/platform/tenants/:id
   * Body validated by updateTenantMetadataSchema.
   * Supports optional logo file upload (multipart/form-data).
   */
  static async updateMetadata(req, res, next) {
    try {
      const updated = await PlatformTenantService.updateMetadata(
        req.params.id,
        req.body,
        req.file || null,
      );
      return res.status(200).json(successResponse(updated, 'Tenant actualizado'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * PATCH /api/v1/platform/tenants/:id/suspend
   * Body validated by suspendTenantSchema.
   */
  static async suspend(req, res, next) {
    try {
      const actorId = req.user._id || req.user.userId;
      const updated = await PlatformTenantService.suspend(
        req.params.id,
        req.body.reason,
        actorId,
      );
      return res.status(200).json(successResponse(updated, 'Tenant suspendido'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * PATCH /api/v1/platform/tenants/:id/reactivate
   */
  static async reactivate(req, res, next) {
    try {
      const actorId = req.user._id || req.user.userId;
      const updated = await PlatformTenantService.reactivate(req.params.id, actorId);
      return res.status(200).json(successResponse(updated, 'Tenant reactivado'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/v1/platform/tenants/:id
   */
  static async softDelete(req, res, next) {
    try {
      const actorId = req.user._id || req.user.userId;
      await PlatformTenantService.softDelete(req.params.id, actorId);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  }
}

export const platformTenantController = PlatformTenantController;
