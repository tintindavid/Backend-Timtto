import { inventarioRepuestoService } from '../services/inventarioRepuesto.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class InventarioRepuestoController {
  async create(req, res, next) {
    try {
      const data = await inventarioRepuestoService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Inventario de repuesto creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await inventarioRepuestoService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Inventario de repuestos recuperado exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await inventarioRepuestoService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Inventario de repuesto recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await inventarioRepuestoService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Inventario de repuesto actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await inventarioRepuestoService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Inventario de repuesto eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const inventarioRepuestoController = new InventarioRepuestoController();
