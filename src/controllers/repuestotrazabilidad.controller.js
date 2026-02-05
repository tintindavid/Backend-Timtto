import { repuestoTrazabilidadService } from '../services/repuestotrazabilidad.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class RepuestoTrazabilidadController {
  async create(req, res, next) {
    try {
      const data = await repuestoTrazabilidadService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'RepuestoTrazabilidad creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await repuestoTrazabilidadService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'RepuestoTrazabilidads recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await repuestoTrazabilidadService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'RepuestoTrazabilidad recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await repuestoTrazabilidadService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'RepuestoTrazabilidad actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await repuestoTrazabilidadService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'RepuestoTrazabilidad eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const repuestoTrazabilidadController = new RepuestoTrazabilidadController();
