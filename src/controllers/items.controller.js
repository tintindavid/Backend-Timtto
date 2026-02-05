import { logger } from '../config/logger.config.js';
import { itemsService } from '../services/items.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class ItemsController {
  async create(req, res, next) {
    try {
      logger.info('Creating Items', { body: req.body, tenantId: req.tenantId });
      const data = await itemsService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Items creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await itemsService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Itemss recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await itemsService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Items recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await itemsService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Items actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await itemsService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Items eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const itemsController = new ItemsController();
