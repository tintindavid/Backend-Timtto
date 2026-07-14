import { oTService } from '../services/ot.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class OTController {
  async create(req, res, next) {
    try {
      const data = await oTService.create(req.body, req.tenantId, req.user);
      res.status(201).json(successResponse(data, 'OT creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await oTService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'OTs recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await oTService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'OT recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await oTService.update(req.params.id, req.body, req.tenantId, req.user);
      res.json(successResponse(data, 'OT actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async addEquipos(req, res, next) {
    try {
      const result = await oTService.addEquipos(req.params.id, req.body, req.tenantId, req.user);
      res.status(201).json(successResponse(result, 'Equipos añadidos a OT correctamente', 201));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await oTService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'OT eliminado exitosamente'));
    } catch (err) { next(err); }
  }

  async listNotas(req, res, next) {
    try {
      const data = await oTService.listNotas(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Notas recuperadas exitosamente'));
    } catch (err) { next(err); }
  }

  async addNota(req, res, next) {
    try {
      const data = await oTService.addNota(req.params.id, req.body, req.user, req.tenantId);
      res.status(201).json(successResponse(data, 'Nota agregada', 201));
    } catch (err) { next(err); }
  }

  async deleteNota(req, res, next) {
    try {
      const data = await oTService.deleteNota(req.params.id, req.params.notaId, req.tenantId);
      res.json(successResponse(data, 'Nota eliminada'));
    } catch (err) { next(err); }
  }
}

export const oTController = new OTController();
