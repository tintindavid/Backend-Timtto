import { sedesService } from '../services/sedes.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class SedesController {
  async create(req, res, next) {
    try {
      const data = await sedesService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Sedes creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await sedesService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Sedess recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await sedesService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Sedes recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await sedesService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Sedes actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await sedesService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Sedes eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const sedesController = new SedesController();
