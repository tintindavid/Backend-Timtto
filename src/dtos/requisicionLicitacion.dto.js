import Joi from 'joi';

/**
 * DTOs of the tendering endpoints and of the public supplier portal (change: requisiciones-e3-compras-portal).
 * Strict allowlists with `.unknown(false)`: tenantId, estado, estadoEnvio, tokens, ganadorId, timeline... are NOT in
 * any allowlist, so sending them is a 400 (never silently ignored).
 */

const objectId = Joi.string().hex().length(24);

export const proveedorParamsDto = Joi.object({
  id: objectId.required().label('id'),
  paId: objectId.required().label('paId'),
}).unknown(false);

export const asignarProveedorDto = Joi.object({
  proveedorId: objectId.required().label('proveedorId'),
  correoEnvio: Joi.string().trim().max(254).email({ tlds: { allow: false } }).allow('').optional().label('correoEnvio'),
}).unknown(false);

export const abrirLicitacionDto = Joi.object({
  fechaLimiteCotizacion: Joi.date().iso().required().label('fechaLimiteCotizacion'),
  instrucciones: Joi.string().trim().max(500).allow('').optional().label('instrucciones'),
}).unknown(false);

export const ampliarFechaLimiteDto = Joi.object({
  fechaLimiteCotizacion: Joi.date().iso().required().label('fechaLimiteCotizacion'),
}).unknown(false);

export const reenviarInvitacionDto = Joi.object({
  correoEnvio: Joi.string().trim().max(254).email({ tlds: { allow: false } }).allow('').optional().label('correoEnvio'),
}).unknown(false).default({});

/** Quotation fields (internal multipart and public portal). The file travels in the `archivo` multipart part. */
const cotizacionFields = {
  linkPropuesta: Joi.string().trim().max(2000).allow('').optional().label('linkPropuesta'),
  observacion: Joi.string().trim().max(2000).allow('').optional().label('observacion'),
  valorTotal: Joi.number().min(0).max(1e13).optional().label('valorTotal'),
  moneda: Joi.string().trim().uppercase().pattern(/^[A-Za-z]{3}$/).allow('').optional().label('moneda'),
  tiempoEntregaDias: Joi.number().integer().min(0).max(3650).optional().label('tiempoEntregaDias'),
};

export const cotizacionDto = Joi.object(cotizacionFields).unknown(false).default({});
export const portalRespuestaDto = Joi.object(cotizacionFields).unknown(false).default({});

export const portalRespuestaInvitacionDto = Joi.object({
  aceptar: Joi.boolean().strict().required().label('aceptar'),
}).unknown(false);

export const compraDirectaDto = Joi.object({
  proveedorId: objectId.required().label('proveedorId'),
  // The minimum length is checked by the service so the answer is the specific 400 JUSTIFICACION_CORTA.
  justificacion: Joi.string().trim().max(2000).allow('').required().label('justificacion'),
}).unknown(false);

/** Endpoints with no body at all (close, select winner): anything sent is rejected. */
export const emptyBodyDto = Joi.object({}).unknown(false).default({});
