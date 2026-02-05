import { actividadReporteService } from '../services/actividadreporte.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class ActividadReporteController {
  async create(req, res, next) {
    try {
      const data = await actividadReporteService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'ActividadReporte creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await actividadReporteService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'ActividadReportes recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await actividadReporteService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'ActividadReporte recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await actividadReporteService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'ActividadReporte actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await actividadReporteService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'ActividadReporte eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const actividadReporteController = new ActividadReporteController();
