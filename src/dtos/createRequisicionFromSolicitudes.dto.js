import Joi from 'joi';
import { REQUISICION_MAX_LINEAS, REQUISICION_PRIORIDAD_VALUES } from '../constants/requisicion.constants.js';

/**
 * Payload of `POST /repuestos/requisicion` (change: requisiciones-e2-solicitudes-recepcion). Strict allowlist
 * (`unknown(false)`): `tenantId`, `estado`, `consecutivo`, the link fields and every protected requisition field are not
 * accepted. The server fixes the type (REPUESTO) and the area (the caller's own; `areaId` only honored when the caller has none). No prices accepted. `lineas` optionally overrides quantity /
 * description of a selected solicitud.
 */
const objectId = Joi.string().hex().length(24);

const lineaOverrideDto = Joi.object({
  repuestoId: objectId.required().label('repuestoId'),
  cantidad: Joi.number().greater(0).optional().label('cantidad'),
  descripcion: Joi.string().trim().min(1).max(300).optional().label('descripcion'),
}).unknown(false);

export const createRequisicionFromSolicitudesDto = Joi.object({
  repuestoIds: Joi.array().items(objectId).min(1).max(REQUISICION_MAX_LINEAS).unique().required().label('repuestoIds'),
  titulo: Joi.string().trim().min(1).max(200).optional().label('titulo'),
  areaId: objectId.optional().label('areaId'),
  prioridad: Joi.string().valid(...REQUISICION_PRIORIDAD_VALUES).optional().label('prioridad'),
  fechaRequerida: Joi.date().iso().allow(null).optional().label('fechaRequerida'),
  justificacion: Joi.string().trim().max(2000).allow('').optional().label('justificacion'),
  lineas: Joi.array().items(lineaOverrideDto).max(REQUISICION_MAX_LINEAS).optional().label('lineas'),
  enviar: Joi.boolean().optional().label('enviar'),
}).unknown(false);
