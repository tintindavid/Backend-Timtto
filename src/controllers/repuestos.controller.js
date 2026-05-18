import { repuestosService } from '../services/repuestos.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class RepuestosController {
  async create(req, res, next) {
    try {
      const data = await repuestosService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Repuestos creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, ...filters } = req.query;
      const result = await repuestosService.list(filters, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Repuestoss recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await repuestosService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Repuestos recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  //Lista los repuestos asociados a un equipo con estado diferente a instalado o rechazado
  async listByEquipo(req, res, next) {
    try {
      const { equipoId } = req.params;
      const { page, limit, sortBy, order } = req.query;
        const { estado } = req.query;
        // Si no se especifica estado, excluir 'Instalado' y 'Rechazado' por defecto
        const estadoFilter = estado ? (Array.isArray(estado) ? estado : [estado]) : ['Instalado', 'Rechazado'];
        const result = await repuestosService.listByEquipo(equipoId, estadoFilter, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Repuestos por equipo recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async listByEquipoAll(req, res, next) { //Lista todos los repuestos asociados a un equipo sin importar el estado
    try {
      const { equipoId } = req.params;
      const { page, limit, sortBy, order } = req.query;
      const result = await repuestosService.listByEquipo(equipoId, null, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Repuestos por equipo recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async listByReport(req, res, next) {
    try {
      const { reportId } = req.params;
      const { page, limit, sortBy, order } = req.query;
      const result = await repuestosService.listByReport(reportId, { page, limit, sortBy, order, search: req.query.search }, req.tenantId);
      res.json(successResponse(result.data, 'Repuestos por reporte recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await repuestosService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Repuestos actualizado exitosamente'));
    } catch (err) { next(err); }
  }

  async createOtFromSolicitudes(req, res, next) {
    try {
      const data = await repuestosService.createOtFromSolicitudes(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'OT creada desde solicitudes de repuestos', 201));
    } catch (err) { next(err); }
  }

  async delete(req, res, next) {
    try {
      await repuestosService.delete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'Repuestos eliminado exitosamente'));
    } catch (err) { next(err); }
  }
}

export const repuestosController = new RepuestosController();
