import { TenantService } from '../services/tenant.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class TenantController {
  static async create(req, res, next) {
    try {
      const payload = req.body;
      // req.file contiene el archivo de logo si se proporcionó
      const tenant = await TenantService.create(payload, req.file);
      return res.status(201).json(successResponse(tenant, 'Tenant created'));
    } catch (err) {
      return next(err);
    }
  }

  static async get(req, res, next) {
    try {
      // Usar tenantId del request (de header o token) o del parámetro
      const tenantId = req.tenantId || req.params.id;
      const tenant = await TenantService.getByTenantId(tenantId);
      return res.json(successResponse(tenant, 'Tenant recuperado exitosamente'));
    } catch (err) {
      return next(err);
    }
  }

  static async list(req, res, next) {
    try {
      const { page = 1, limit = 10, search } = req.query;
      const result = await TenantService.list({ 
        page: Number(page), 
        limit: Number(limit),
        search 
      });
      return res.json(successResponse(result.data, 'Tenants recuperados exitosamente', 200, result.pagination));
    } catch (err) {
      return next(err);
    }
  }

  static async update(req, res, next) {
    try {
      const { id } = req.params;
      const payload = req.body;
      // req.file contiene el nuevo logo si se proporcionó
      const tenant = await TenantService.update(id, payload, req.file);
      return res.json(successResponse(tenant, 'Tenant updated'));
    } catch (err) {
      return next(err);
    }
  }

  static async remove(req, res, next) {
    try {
      const { id } = req.params;
      const tenant = await TenantService.softDelete(id);
      return res.json(successResponse(tenant, 'Tenant soft-deleted'));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Método exclusivo para SuperAdmin
   * Lista TODOS los tenants sin restricción de tenant
   */
  static async listAllForSuperAdmin(req, res, next) {
    try {
      const { page = 1, limit = 10, search, includeDeleted } = req.query;
      const result = await TenantService.listAll({ 
        page: Number(page), 
        limit: Number(limit),
        search,
        includeDeleted: includeDeleted === 'true'
      });
      return res.json(successResponse(result.data, 'Todos los tenants recuperados exitosamente', 200, result.pagination));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Método exclusivo para SuperAdmin
   * Obtiene cualquier tenant por ID sin restricción
   */
  static async getAnyTenant(req, res, next) {
    try {
      const { id } = req.params;
      const tenant = await TenantService.getByTenantId(id);
      return res.json(successResponse(tenant, 'Tenant recuperado exitosamente'));
    } catch (err) {
      return next(err);
    }
  }
}
