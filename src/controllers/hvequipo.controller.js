import { hVEquipoService } from '../services/hvequipo.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class HVEquipoController {
  async create(req, res, next) {
    try {
      const data = await hVEquipoService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'HVEquipo creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await hVEquipoService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'HVEquipos recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await hVEquipoService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'HVEquipo recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await hVEquipoService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'HVEquipo actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await hVEquipoService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'HVEquipo eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const hVEquipoController = new HVEquipoController();
