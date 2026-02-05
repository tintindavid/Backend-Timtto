import { informeService } from '../services/informe.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class InformeController {
  async create(req, res, next) {
    try {
      const data = await informeService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Informe creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await informeService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Informes recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await informeService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Informe recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await informeService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Informe actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await informeService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Informe eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const informeController = new InformeController();
