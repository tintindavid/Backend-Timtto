import { areaService } from '../services/area.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class AreaController {
  async create(req, res, next) {
    try {
      const data = await areaService.create(req.tenantId, req.body);
      res.status(201).json(successResponse(data, 'Área creada exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await areaService.list(req.tenantId, filters, { page, limit, sortBy, order });
      res.json(successResponse(result.data, 'Áreas recuperadas exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await areaService.getById(req.tenantId, req.params.id);
      res.json(successResponse(data, 'Área recuperada exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await areaService.update(req.tenantId, req.params.id, req.body);
      res.json(successResponse(data, 'Área actualizada exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await areaService.delete(req.tenantId, req.params.id);
      res.json(successResponse(null, 'Área eliminada exitosamente'));
    } catch (err) { next(err); }
  }
}

export const areaController = new AreaController();
