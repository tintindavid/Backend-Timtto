import { reglaAprobacionService } from '../services/reglaAprobacion.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class ReglaAprobacionController {
  async create(req, res, next) {
    try {
      const data = await reglaAprobacionService.create(req.tenantId, req.body);
      res.status(201).json(successResponse(data, 'Regla de aprobación creada exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, ...filters } = req.query;
      const result = await reglaAprobacionService.list(req.tenantId, filters, { page, limit });
      // Diagnostics never break the listing.
      const warnings = await reglaAprobacionService.getWarnings(req.tenantId).catch(() => []);
      res.json({ ...successResponse(result.data, 'Reglas de aprobación recuperadas exitosamente', 200, result.pagination), warnings });
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await reglaAprobacionService.getById(req.tenantId, req.params.id);
      res.json(successResponse(data, 'Regla de aprobación recuperada exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await reglaAprobacionService.update(req.tenantId, req.params.id, req.body);
      res.json(successResponse(data, 'Regla de aprobación actualizada exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await reglaAprobacionService.delete(req.tenantId, req.params.id);
      res.json(successResponse(null, 'Regla de aprobación eliminada exitosamente'));
    } catch (err) { next(err); }
  }
}

export const reglaAprobacionController = new ReglaAprobacionController();
