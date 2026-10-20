'use strict';
import { reporteExternoService } from '../services/reporteExterno.service.js';
import { ApiError } from '../utils/apiError.util.js';
import { successResponse } from '../utils/apiResponse.util.js';

/** multipart sends the nested `verificationParam` array as a JSON string. */
export function parseMultipartVerificationParam(body) {
  if (body && typeof body.verificationParam === 'string') {
    try {
      body.verificationParam = JSON.parse(body.verificationParam);
    } catch {
      throw new ApiError(400, 'verificationParam debe ser JSON válido', 'VALIDATION_ERROR');
    }
  }
}

export const reporteExternoController = {
  /** Pre-validation step for POST (runs before validate(createReporteExternoDto)). */
  parseBody(req, _res, next) {
    try { parseMultipartVerificationParam(req.body); next(); } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      const { report, warnings } = await reporteExternoService.create({
        tenantId: req.tenantId,
        equipoId: req.params.equipoId,
        dto: req.body,
        file: req.file ?? null,
        capabilities: req.tenant?.capabilities,
        panelUser: req.user,
      });
      res.status(201).json({ ...successResponse(report, 'Servicio externo registrado', 201), warnings });
    } catch (err) { next(err); }
  },

  async remove(req, res, next) {
    try {
      const data = await reporteExternoService.remove({
        tenantId: req.tenantId,
        equipoId: req.params.equipoId,
        id: req.params.id,
        capabilities: req.tenant?.capabilities,
        panelUser: req.user,
      });
      res.status(200).json(successResponse(data, 'Servicio externo eliminado'));
    } catch (err) { next(err); }
  },
};
