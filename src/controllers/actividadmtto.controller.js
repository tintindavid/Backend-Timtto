import { actividadMttoService } from '../services/actividadmtto.service.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { logger } from '../config/logger.config.js';

export class ActividadMttoController {
  async create(req, res, next) {
    try {
      const data = await actividadMttoService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'ActividadMtto creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await actividadMttoService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'ActividadMttos recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await actividadMttoService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'ActividadMtto recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await actividadMttoService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'ActividadMtto actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await actividadMttoService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'ActividadMtto eliminado exitosamente'));
    } catch (err) { next(err); }
  }

  async searchByName(req, res, next) {
    try {
      const { q } = req.query;
      if (!q || q.trim() === '') {
        return res.status(400).json({ success: false, message: 'El parámetro de búsqueda "q" es requerido' });
      }
      const data = await actividadMttoService.searchByName(q.trim(), req.tenantId);
      res.json(successResponse(data, `Búsqueda completada: ${data.length} resultados`));
    } catch (err) { next(err); }
  }
}

export const actividadMttoController = new ActividadMttoController();
