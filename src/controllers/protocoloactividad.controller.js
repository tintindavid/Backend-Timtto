import { protocoloActividadService } from '../services/protocoloactividad.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class ProtocoloActividadController {
  async create(req, res, next) {
    try {
      const data = await protocoloActividadService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'ProtocoloActividad creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await protocoloActividadService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'ProtocoloActividads recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await protocoloActividadService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'ProtocoloActividad recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await protocoloActividadService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'ProtocoloActividad actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await protocoloActividadService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'ProtocoloActividad eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const protocoloActividadController = new ProtocoloActividadController();
