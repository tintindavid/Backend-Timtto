import { customerNoUsarService } from '../services/customernousar.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class CustomerNoUsarController {
  async create(req, res, next) {
    try {
      const data = await customerNoUsarService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'CustomerNoUsar creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await customerNoUsarService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'CustomerNoUsars recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await customerNoUsarService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'CustomerNoUsar recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await customerNoUsarService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'CustomerNoUsar actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await customerNoUsarService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'CustomerNoUsar eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const customerNoUsarController = new CustomerNoUsarController();
