import { serviciosService } from '../services/servicios.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class ServiciosController {
  async create(req, res, next) {
    try {
      const data = await serviciosService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Servicios creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await serviciosService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Servicioss recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await serviciosService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Servicios recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await serviciosService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Servicios actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await serviciosService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Servicios eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const serviciosController = new ServiciosController();
