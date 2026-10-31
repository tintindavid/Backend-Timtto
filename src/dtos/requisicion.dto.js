import Joi from 'joi';
import {
  CONFIRMACION_RESULTADO_VALUES,
  REQUISICION_ESTADO,
  REQUISICION_ESTADO_VALUES,
  REQUISICION_MAX_LINEAS,
  REQUISICION_PRIORIDAD_VALUES,
  REQUISICION_SORT_FIELDS,
} from '../constants/requisicion.constants.js';

/**
 * DTOs of the requisitions module (change: requisiciones-e1-base-aprobacion, design D13). Strict allowlists with
 * `.unknown(false)`: the protected fields (tenantId, consecutivo, estado, creadaPor, montoEstimado, aprobacion,
 * timeline, abastecimiento, isDeleted, fulfilment/purchase/reception fields and the line `snapshot`) are not in the
 * allowlist, so sending them is a 400 (never silently ignored).
 */

const objectId = Joi.string().hex().length(24);
const dateOnly = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} debe tener formato YYYY-MM-DD' });

// A line either references a stock item (description/unit/price default from it) or is free text.
const lineaDto = Joi.object({
  lineaId: objectId.optional().label('lineaId'),
  inventarioItemId: objectId.allow(null).optional().label('inventarioItemId'),
  descripcion: Joi.when('inventarioItemId', {
    is: Joi.string().required(),
    then: Joi.string().trim().min(1).max(300).optional(),
    otherwise: Joi.string().trim().min(1).max(300).required(),
  }).label('descripcion'),
  especificaciones: Joi.string().trim().max(1000).allow('').optional().label('especificaciones'),
  unidad: Joi.when('inventarioItemId', {
    is: Joi.string().required(),
    then: Joi.string().trim().min(1).max(30).optional(),
    otherwise: Joi.string().trim().min(1).max(30).required(),
  }).label('unidad'),
  cantidadSolicitada: Joi.number().greater(0).required().label('cantidadSolicitada'),
  precioEstimado: Joi.number().min(0).optional().label('precioEstimado'),
}).unknown(false);

const lineas = Joi.array().items(lineaDto).min(1).max(REQUISICION_MAX_LINEAS).label('lineas');

export const createRequisicionDto = Joi.object({
  titulo: Joi.string().trim().min(1).max(200).required().label('titulo'),
  tipoRequisicionId: objectId.required().label('tipoRequisicionId'),
  areaId: objectId.required().label('areaId'),
  prioridad: Joi.string().valid(...REQUISICION_PRIORIDAD_VALUES).optional().label('prioridad'),
  fechaRequerida: Joi.date().iso().allow(null).optional().label('fechaRequerida'),
  justificacion: Joi.string().trim().max(2000).allow('').optional().label('justificacion'),
  solicitanteId: objectId.optional().label('solicitanteId'),
  lineas: lineas.required(),
}).unknown(false);

// `tipoRequisicionId` is accepted by the schema ONLY so the service answers 400 TIPO_INMUTABLE (not a generic error).
export const updateRequisicionDto = Joi.object({
  titulo: Joi.string().trim().min(1).max(200).optional().label('titulo'),
  tipoRequisicionId: Joi.any().optional(),
  areaId: objectId.optional().label('areaId'),
  prioridad: Joi.string().valid(...REQUISICION_PRIORIDAD_VALUES).optional().label('prioridad'),
  fechaRequerida: Joi.date().iso().allow(null).optional().label('fechaRequerida'),
  justificacion: Joi.string().trim().max(2000).allow('').optional().label('justificacion'),
  solicitanteId: objectId.optional().label('solicitanteId'),
  lineas: lineas.optional(),
}).unknown(false).min(1);

export const enviarRequisicionDto = Joi.object({
  justificacion: Joi.string().trim().min(1).max(2000).optional().label('justificacion'),
}).unknown(false).default({});

export const cancelarRequisicionDto = Joi.object({
  motivo: Joi.string().trim().min(1).max(2000).required().label('motivo'),
}).unknown(false);

// PATCH /:id/estado: only the "back to Borrador" moves (retire from En_Aprobacion / reopen from Rechazada).
export const cambiarEstadoRequisicionDto = Joi.object({
  estado: Joi.string().valid(REQUISICION_ESTADO.BORRADOR).required().label('estado'),
  observacion: Joi.string().trim().min(1).max(2000).optional().label('observacion'),
}).unknown(false);

// `version` = the content version the approver saw (409 VERSION_DESACTUALIZADA when it no longer matches).
export const aprobarRequisicionDto = Joi.object({
  version: Joi.number().integer().min(1).required().label('version'),
  observacion: Joi.string().trim().max(2000).allow('').optional().label('observacion'),
}).unknown(false);

export const rechazarRequisicionDto = Joi.object({
  version: Joi.number().integer().min(1).required().label('version'),
  observacion: Joi.string().trim().min(1).max(2000).required().label('observacion'),
}).unknown(false);

export const reasignarAprobadoresDto = Joi.object({
  nivelOrden: Joi.number().integer().min(1).required().label('nivelOrden'),
  aprobadorIds: Joi.array().items(objectId).min(1).max(50).unique().required().label('aprobadorIds'),
  observacion: Joi.string().trim().min(1).max(2000).optional().label('observacion'),
}).unknown(false);

export const REQUISICION_VISTAS = Object.freeze(['mias', 'por-aprobar', 'por-recibir', 'por-confirmar']);

export const queryRequisicionDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  estado: Joi.string().valid(...REQUISICION_ESTADO_VALUES).optional(),
  areaId: objectId.optional(),
  tipoRequisicionId: objectId.optional(),
  creadaPor: objectId.optional(),
  fechaDesde: dateOnly.optional().label('fechaDesde'),
  fechaHasta: dateOnly.optional().label('fechaHasta'),
  search: Joi.string().trim().max(100).optional(),
  vista: Joi.string().valid(...REQUISICION_VISTAS).optional(),
  sortBy: Joi.string().valid(...REQUISICION_SORT_FIELDS).default('createdAt'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
}).unknown(false);

// --- Reception (E2: requisiciones-e2-solicitudes-recepcion) ---------------------------------------------------

/**
 * Body of POST /:id/recepciones (multipart/form-data: the files travel under `evidencias`, handled by Multer). `items`
 * arrives as a JSON string (Joi parses a string that looks like an array); the array is then validated normally.
 */
// multipart/form-data sends `items` as a JSON string: parse it (only when it looks like an array) before validating.
const JoiJsonArray = Joi.extend((joi) => ({
  type: 'array',
  base: joi.array(),
  coerce: {
    from: 'string',
    method(value) {
      const text = value.trim();
      if (!text.startsWith('[')) return undefined;
      try { return { value: JSON.parse(text) }; } catch { return undefined; }
    },
  },
}));

export const registrarRecepcionDto = Joi.object({
  fecha: Joi.date().iso().optional().label('fecha'),
  documento: Joi.string().trim().max(200).allow('').optional().label('documento'),
  observacion: Joi.string().trim().max(2000).allow('').optional().label('observacion'),
  items: JoiJsonArray.array().items(Joi.object({
    lineaId: objectId.required().label('lineaId'),
    cantidadRecibida: Joi.number().greater(0).required().label('cantidadRecibida'),
  }).unknown(false)).min(1).max(REQUISICION_MAX_LINEAS).required().label('items'),
}).unknown(false);

/** Body of POST /:id/recepciones/:recepcionId/confirmar. The quantity / observation rules per result live in the service. */
export const confirmarEntregaDto = Joi.object({
  items: Joi.array().items(Joi.object({
    lineaId: objectId.required().label('lineaId'),
    resultado: Joi.string().valid(...CONFIRMACION_RESULTADO_VALUES).required().label('resultado'),
    cantidad: Joi.number().min(0).optional().label('cantidad'),
    observacion: Joi.string().trim().max(2000).allow('').optional().label('observacion'),
  }).unknown(false)).min(1).max(REQUISICION_MAX_LINEAS).required().label('items'),
}).unknown(false);

/** `motivo` is checked by the service so the answer is the specific 400 MOTIVO_REQUERIDO. */
export const cerrarLineaDto = Joi.object({
  motivo: Joi.string().trim().max(2000).allow('').optional().label('motivo'),
}).unknown(false).default({});

export const recepcionParamsDto = Joi.object({
  id: objectId.required().label('id'),
  recepcionId: objectId.required().label('recepcionId'),
}).unknown(false);

export const lineaParamsDto = Joi.object({
  id: objectId.required().label('id'),
  lineaId: objectId.required().label('lineaId'),
}).unknown(false);
