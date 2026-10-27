import { presupuestoAreaService } from '../services/presupuestoArea.service.js';
import { presupuestoService } from '../services/presupuesto.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class PresupuestoAreaController {
  async create(req, res, next) {
    try {
      const data = await presupuestoAreaService.create(req.tenantId, req.body);
      res.status(201).json(successResponse(data, 'Presupuesto creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, ...filters } = req.query;
      const result = await presupuestoAreaService.list(req.tenantId, filters, { page, limit });
      res.json(successResponse(result.data, 'Presupuestos recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async resumen(req, res, next) {
    try {
      const data = await presupuestoService.getResumen(req.tenantId, { areaId: req.query.areaId, periodo: req.query.periodo });
      res.json(successResponse(data, 'Resumen de presupuesto recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await presupuestoAreaService.getById(req.tenantId, req.params.id);
      res.json(successResponse(data, 'Presupuesto recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await presupuestoAreaService.update(req.tenantId, req.params.id, req.body);
      res.json(successResponse(data, 'Presupuesto actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await presupuestoAreaService.delete(req.tenantId, req.params.id);
      res.json(successResponse(null, 'Presupuesto eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const presupuestoAreaController = new PresupuestoAreaController();
