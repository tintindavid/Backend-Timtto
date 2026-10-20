import Joi from 'joi';
import { EstadoOperativoValues } from '../constants/estadoOperativo.js';
import {
  MAX_MAGNITUD_LENGTH,
  MAX_UNIDAD_LENGTH,
  MAX_PATRON_LENGTH,
} from '../constants/verificationParam.constants.js';
import { MAX_VERIFICATION_ROWS } from '../utils/verificationParams.util.js';

const objectId = Joi.string().length(24).hex();

const number = Joi.alternatives().try(Joi.number(), Joi.string().trim().pattern(/^-?\d+([.,]\d+)?$/)).allow(null, '');

const verificationRow = Joi.object({
  magnitud: Joi.string().trim().max(MAX_MAGNITUD_LENGTH).allow(''),
  unidad: Joi.string().trim().max(MAX_UNIDAD_LENGTH).allow(''),
  valorReferencia: number,
  valorMedido: number,
  patron: Joi.string().trim().max(MAX_PATRON_LENGTH).allow(''),
}).unknown(false);

/**
 * Body of POST /equipos/:equipoId/reportes-externos. The consecutive, the tenant, the state and the origin
 * are never accepted from the client (unknown fields are rejected).
 */
export const createReporteExternoDto = Joi.object({
  tipoMtto: Joi.string().valid('Preventivo', 'Correctivo').required(),
  // A date-only value arrives as midnight UTC, which a client in Colombia renders as the day before. Midday UTC is
  // the same calendar day in every timezone from UTC-12 to UTC+11.
  fecha: Joi.date().iso().max('now').required().custom((value) => {
    const d = new Date(value);
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) d.setUTCHours(12);
    return d;
  }),
  estadoOperativo: Joi.string().valid(...EstadoOperativoValues).required(),
  proveedorId: objectId.optional(),
  proveedor: Joi.string().trim().max(200).when('proveedorId', { is: Joi.exist(), then: Joi.optional().allow(''), otherwise: Joi.required() }),
  consecutivoDocumento: Joi.string().trim().max(100).allow('').optional(),
  observacion: Joi.string().trim().max(2000).allow('').optional(),
  enlace: Joi.string().uri({ scheme: ['http', 'https'] }).allow('').optional(),
  verificationParam: Joi.array().items(verificationRow).max(MAX_VERIFICATION_ROWS).optional(),
}).unknown(false);
