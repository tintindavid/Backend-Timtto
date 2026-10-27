import { tipoRequisicionService } from '../services/tipoRequisicion.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class TipoRequisicionController {
  async create(req, res, next) {
    try {
      const data = await tipoRequisicionService.create(req.tenantId, req.body);
      res.status(201).json(successResponse(data, 'Tipo de requisición creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await tipoRequisicionService.list(req.tenantId, filters, { page, limit, sortBy, order });
      res.json(successResponse(result.data, 'Tipos de requisición recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await tipoRequisicionService.getById(req.tenantId, req.params.id);
      res.json(successResponse(data, 'Tipo de requisición recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await tipoRequisicionService.update(req.tenantId, req.params.id, req.body);
      res.json(successResponse(data, 'Tipo de requisición actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await tipoRequisicionService.delete(req.tenantId, req.params.id);
      res.json(successResponse(null, 'Tipo de requisición eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const tipoRequisicionController = new TipoRequisicionController();
