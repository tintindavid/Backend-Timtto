import Joi from 'joi';
import { TIPOS_ACTIVIDAD_EXTERNA } from '../models/cadenaActividad.model.js';
import { ESTADOS_FINAL } from '../models/equipoActividadExterna.model.js';

const objectId = Joi.string().length(24).hex();

const frecuencia = Joi.object({
  meses: Joi.number().integer().min(1).when('esUnica', { is: false, then: Joi.required() }),
  esUnica: Joi.boolean().required(),
}).required();

export const createActividadExternaDto = Joi.object({
  tipo: Joi.string().valid(...TIPOS_ACTIVIDAD_EXTERNA).required(),
  tipoCustom: Joi.string().trim().when('tipo', { is: 'otro', then: Joi.required() }),
  consecutivoExterno: Joi.string().trim().required(),
  fecha: Joi.date().iso().max('now').required(),
  proveedorId: objectId.optional(),
  proveedor: Joi.string().trim().when('proveedorId', { is: Joi.exist(), then: Joi.optional(), otherwise: Joi.required() }),
  observacion: Joi.string().trim().allow('').optional(),
  estadoFinal: Joi.string().valid(...ESTADOS_FINAL).required(),
  estadoFinalCustom: Joi.string().trim().when('estadoFinal', { is: 'otro', then: Joi.required() }),
  enlace: Joi.string().uri({ scheme: ['http', 'https'] }).optional(),
  frecuencia,
  cadenaIdSucesion: objectId.optional(),
});

export const updateActividadExternaDto = Joi.object({
  observacion: Joi.string().trim().allow('').optional(),
  estadoFinal: Joi.string().valid(...ESTADOS_FINAL).optional(),
  estadoFinalCustom: Joi.string().trim().when('estadoFinal', { is: 'otro', then: Joi.required() }).optional(),
  enlace: Joi.string().uri({ scheme: ['http', 'https'] }).allow(null, '').optional(),
  // '' or null unlinks the provider (multipart bodies cannot carry null); the last `proveedor` text is kept.
  proveedorId: objectId.allow(null, '').optional(),
  proveedor: Joi.string().trim().optional(),
}).min(1).unknown(false);

export const cerrarCadenaDto = Joi.object({
  motivoCierre: Joi.string().trim().required(),
});
