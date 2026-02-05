import { logger } from '../config/logger.config.js';
import { equipoItemService } from '../services/equipoItem.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class EquipoItemController {
  async create(req, res, next) {
    try {

      const data = await equipoItemService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'EquipoItem creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;

      logger.info(`Listando EquipoItems con filtros: ${JSON.stringify(filters)}, página: ${page}, límite: ${limit}, orden: ${sortBy} ${order}`);
      const result = await equipoItemService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'EquipoItems recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await equipoItemService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'EquipoItem recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await equipoItemService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'EquipoItem actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async updateSnapshot(req, res, next) {
    try {
      const equipoId = req.params.id;
      const payload = req.body;
      const result = await equipoItemService.updateAndSnapshot(equipoId, payload, req.tenantId);
      res.json(successResponse(result, 'Equipo y snapshot de Report actualizados exitosamente'));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await equipoItemService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'EquipoItem eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const equipoItemController = new EquipoItemController();
