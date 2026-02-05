import { estadoEquipoService } from '../services/estadoEquipo.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class EstadoEquipoController {
  async create(req, res, next) {
    try {
      const data = await estadoEquipoService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'EstadoEquipo creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await estadoEquipoService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'EstadoEquipos recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await estadoEquipoService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'EstadoEquipo recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await estadoEquipoService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'EstadoEquipo actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await estadoEquipoService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'EstadoEquipo eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const estadoEquipoController = new EstadoEquipoController();
