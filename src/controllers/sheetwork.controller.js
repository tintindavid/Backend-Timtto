import { sheetWorkService } from '../services/sheetwork.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class SheetWorkController {
  async create(req, res, next) {
    try {
      const data = await sheetWorkService.create(req.body, req.tenantId);
    
      res.status(201).json(successResponse(data, 'SheetWork creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await sheetWorkService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'SheetWorks recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await sheetWorkService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'SheetWork recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async listByOt(req, res, next) {
    try {
      const otId = req.params.otId;
      const result = await sheetWorkService.listByOt(otId, {}, req.tenantId);
      res.json(successResponse(result.data, 'SheetWorks por OT recuperados', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await sheetWorkService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'SheetWork actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await sheetWorkService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'SheetWork eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const sheetWorkController = new SheetWorkController();
