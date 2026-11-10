import Joi from 'joi';
import { OC_CONDICIONES_MAX, REQUISICION_MAX_LINEAS } from '../constants/requisicion.constants.js';

/**
 * DTOs of the purchase order and deliverables endpoints (change: requisiciones-e4-oc-recepcion). Strict allowlists with
 * `.unknown(false)`: tenantId, numero, total, estado, emitidaPor, version... are NOT in any allowlist, so sending them is a
 * 400 (never silently ignored). The quantity of each line comes from the requisition, never from the payload.
 */

const objectId = Joi.string().hex().length(24);

const ocLineaDto = Joi.object({
  lineaId: objectId.required().label('lineaId'),
  // The business rule (finite number >= 0) is re-checked by the service so the answer is the specific 400 PRECIO_INVALIDO.
  precioUnitario: Joi.number().strict().min(0).max(1e12).required().label('precioUnitario'),
}).unknown(false);

const ocFields = {
  lineas: Joi.array().items(ocLineaDto).min(1).max(REQUISICION_MAX_LINEAS).required().label('lineas'),
  condiciones: Joi.string().trim().max(OC_CONDICIONES_MAX).allow('').optional().label('condiciones'),
  // Date-only `YYYY-MM-DD` stays a string (the service reads it as that day in America/Bogota); a full ISO timestamp is accepted too.
  fechaEntrega: Joi.alternatives().try(Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/), Joi.date().iso()).required().label('fechaEntrega'),
  requiereEntregables: Joi.boolean().strict().required().label('requiereEntregables'),
};

export const emitirOrdenCompraDto = Joi.object(ocFields).unknown(false);
export const editarOrdenCompraDto = Joi.object(ocFields).unknown(false);

/** Approve: optional OC version the approver saw (409 VERSION_DESACTUALIZADA if it moved) and an optional note. */
export const aprobarOrdenCompraDto = Joi.object({
  version: Joi.number().integer().min(1).optional().label('version'),
  observacion: Joi.string().trim().max(2000).allow('').optional().label('observacion'),
}).unknown(false).default({});

/** Reject: the observation is mandatory (the service answers the specific 400 OBSERVACION_REQUERIDA when blank). */
export const rechazarOrdenCompraDto = Joi.object({
  observacion: Joi.string().trim().max(2000).allow('').required().label('observacion'),
  version: Joi.number().integer().min(1).optional().label('version'),
}).unknown(false);

export const reenviarOrdenCompraDto = Joi.object({
  correoEnvio: Joi.string().trim().max(254).email({ tlds: { allow: false } }).allow('').optional().label('correoEnvio'),
}).unknown(false).default({});

export const devolverEntregablesDto = Joi.object({
  observacion: Joi.string().trim().max(2000).allow('').required().label('observacion'),
}).unknown(false);

/** The files travel as multipart parts under `archivos` (handled by Multer): no other body field is accepted. */
export const subirEntregablesDto = Joi.object({}).unknown(false).default({});
