import { reportService } from '../services/report.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class ReportController {
  async create(req, res, next) {
    try {
      const data = await reportService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Report creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await reportService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Reports recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async listByOt(req, res, next) {
    try {
      const { otId } = req.params;
      const { page, limit, sortBy, order } = req.query;
      const result = await reportService.listByOt(otId, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Reports por OT recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await reportService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Report recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async procesar(req, res, next) {
    try {
      const reporteId = req.params.reporteId;
      const payload = req.body;
      console.log('Payload procesar report:', payload);
      const result = await reportService.procesar(reporteId, payload, req.tenantId);
      res.json(successResponse(result, 'Report procesado y OT notificada exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await reportService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Report actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await reportService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Report eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const reportController = new ReportController();

