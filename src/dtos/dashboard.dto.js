'use strict';
import Joi from 'joi';

/**
 * Query of every GET /api/v1/dashboard/* endpoint (change: dashboard-por-tenant-indicadores).
 *
 * `tenantId` is accepted only to be DISCARDED: the tenant always comes from `req.tenantId`, never from the client.
 * Calendar validity of `desde`/`hasta`, their order and the 24-month limit are enforced by `resolvePeriod`
 * (VALIDATION_ERROR / PERIOD_TOO_LARGE).
 */
const objectId = () => Joi.string().hex().length(24);
const ymd = () => Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);

export const TIPOS_MTTO_DASHBOARD = Object.freeze(['Preventivo', 'Correctivo', 'Predictivo', 'Instalación', 'Proactivo', 'Diagnostico', 'Diagnóstico']);

export const dashboardQueryDto = Joi.object({
  periodo: Joi.string().valid('mes_actual', 'mes_anterior', 'rango', 'anio').optional(),
  desde: Joi.when('periodo', { is: 'rango', then: ymd().required(), otherwise: Joi.forbidden() }),
  hasta: Joi.when('periodo', { is: 'rango', then: ymd().required(), otherwise: Joi.forbidden() }),
  anio: Joi.when('periodo', { is: 'anio', then: Joi.number().integer().min(2000).max(2100).optional(), otherwise: Joi.forbidden() }),
  clienteId: objectId().optional(),
  sedeId: objectId().optional(),
  servicioId: objectId().optional(),
  tipoMtto: Joi.string().valid(...TIPOS_MTTO_DASHBOARD).optional(),
  tecnicoId: objectId().optional(),
  tenantId: Joi.any().strip(),
}).unknown(false);
