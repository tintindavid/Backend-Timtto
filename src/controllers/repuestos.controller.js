import { repuestosService } from '../services/repuestos.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class RepuestosController {
  async create(req, res, next) {
    try {
      const data = await repuestosService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Repuestos creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await repuestosService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Repuestoss recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await repuestosService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Repuestos recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async listByEquipo(req, res, next) {
    try {
      const { equipoId } = req.params;
      const { page, limit, sortBy, order } = req.query;
      const estado = req.query.estado;
      const result = await repuestosService.listByEquipo(equipoId, estado, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Repuestos por equipo recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async listByReport(req, res, next) {
    try {
      const { reportId } = req.params;
      const { page, limit, sortBy, order } = req.query;
      const result = await repuestosService.listByReport(reportId, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Repuestos por reporte recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await repuestosService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Repuestos actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await repuestosService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Repuestos eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const repuestosController = new RepuestosController();
