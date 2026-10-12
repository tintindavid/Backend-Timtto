'use strict';
import { actividadExternaService } from '../services/actividadExterna.service.js';
import { cadenaActividadService } from '../services/cadenaActividad.service.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { successResponse } from '../utils/apiResponse.util.js';

/** R-PF1: multipart sends nested `frecuencia` as a JSON string. */
export function parseMultipartFrecuencia(body) {
  if (body && typeof body.frecuencia === 'string') {
    try {
      body.frecuencia = JSON.parse(body.frecuencia);
    } catch {
      throw new ApiError(400, 'frecuencia debe ser JSON válido', 'VALIDATION_ERROR');
    }
  }
}

async function deriveClienteId(tenantId, equipoId) {
  const eq = await EquipoItem.findOne({ _id: equipoId, tenantId, isDeleted: false }).lean();
  if (!eq) throw new ApiError(404, 'Equipo no encontrado', 'NOT_FOUND');
  return String(eq.ClienteId);
}

const userIdOf = (req) => req.user.userId ?? req.user._id;

export const actividadExternaController = {
  /** Pre-validation step for POST (runs before validate(createActividadExternaDto)). */
  parseBody(req, _res, next) {
    try { parseMultipartFrecuencia(req.body); next(); } catch (err) { next(err); }
  },
  async list(req, res, next) {
    try {
      const result = await actividadExternaService.listPorEquipo(req.user.tenantId, req.params.equipoId, req.query);
      res.status(200).json({ success: true, ...result });
    } catch (err) { next(err); }
  },
  async getById(req, res, next) {
    try {
      const data = await actividadExternaService.getById(req.user.tenantId, req.params.equipoId, req.params.id);
      res.status(200).json(successResponse(data));
    } catch (err) { next(err); }
  },
  async create(req, res, next) {
    try {
      const { tenantId } = req.user;
      const clienteId = await deriveClienteId(tenantId, req.params.equipoId);
      const data = await actividadExternaService.create(tenantId, req.params.equipoId, clienteId, req.body, req.file, userIdOf(req));
      res.status(201).json(successResponse(data, 'Actividad externa registrada', 201));
    } catch (err) { next(err); }
  },
  async update(req, res, next) {
    try {
      const data = await actividadExternaService.update(req.user.tenantId, req.params.equipoId, req.params.id, req.body, req.file);
      res.status(200).json(successResponse(data));
    } catch (err) { next(err); }
  },
  async remove(req, res, next) {
    try {
      const data = await actividadExternaService.remove(req.user.tenantId, req.params.equipoId, req.params.id);
      res.status(200).json(successResponse(data));
    } catch (err) { next(err); }
  },
  async removeEvidencia(req, res, next) {
    try {
      const data = await actividadExternaService.removeEvidencia(req.user.tenantId, req.params.equipoId, req.params.id);
      res.status(200).json(successResponse(data));
    } catch (err) { next(err); }
  },
  async evidenciaUrl(req, res, next) {
    try {
      const act = await actividadExternaService.getById(req.user.tenantId, req.params.equipoId, req.params.id);
      res.status(200).json(successResponse({ url: act.evidencia?.url ?? null }));
    } catch (err) { next(err); }
  },
};

export const cadenaActividadController = {
  async list(req, res, next) {
    try {
      const { tenantId } = req.user;
      const { equipoId } = req.params;
      if (req.query.estado === 'vigente') {
        const { tipo, tipoCustom } = req.query;
        const data = await cadenaActividadService.listVigentesPorTipo(tenantId, equipoId, { tipo, tipoCustom });
        return res.status(200).json({ success: true, data });
      }
      const result = await cadenaActividadService.listPorEquipo(tenantId, equipoId, req.query);
      res.status(200).json({ success: true, ...result });
    } catch (err) { next(err); }
  },
  async getById(req, res, next) {
    try {
      const data = await cadenaActividadService.getById(req.user.tenantId, req.params.equipoId, req.params.cadenaId);
      res.status(200).json(successResponse(data));
    } catch (err) { next(err); }
  },
  async cerrar(req, res, next) {
    try {
      const data = await cadenaActividadService.cerrarManual(req.user.tenantId, req.params.equipoId, req.params.cadenaId, {
        motivoCierre: req.body.motivoCierre,
        cerradaPorUserId: userIdOf(req),
      });
      res.status(200).json(successResponse(data));
    } catch (err) { next(err); }
  },
};
