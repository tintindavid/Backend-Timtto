import { logger } from '../config/logger.config.js';
import { protocoloMttoService } from '../services/protocolomtto.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class ProtocoloMttoController {
  async create(req, res, next) {
    try {
      const data = await protocoloMttoService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'ProtocoloMtto creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      logger.info('Listing ProtocoloMttos', { query: req.query, tenantId: req.tenantId });
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await protocoloMttoService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'ProtocoloMttos recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await protocoloMttoService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'ProtocoloMtto recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await protocoloMttoService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'ProtocoloMtto actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await protocoloMttoService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'ProtocoloMtto eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const protocoloMttoController = new ProtocoloMttoController();
