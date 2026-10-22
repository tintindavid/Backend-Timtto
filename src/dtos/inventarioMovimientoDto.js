import Joi from 'joi';
import { MOVIMIENTO_TIPOS } from '../models/inventarioMovimiento.model.js';

// `unidad` is free text (decimals such as 1.5 m are legitimate), so decimals are kept; only an absurd magnitude is rejected.
export const MAX_MOVIMIENTO_CANTIDAD = 1e9;

const objectId = Joi.string().hex().length(24);

// Manual movements. tenantId, user, balances and references are never accepted from the body.
// entrada/salida: cantidad > 0. ajuste: signed non-zero delta with a mandatory motivo.
export const createInventarioMovimientoDto = Joi.object({
  itemId: objectId.required().label('itemId'),
  tipo: Joi.string().valid(...MOVIMIENTO_TIPOS).required().label('tipo'),
  cantidad: Joi.when('tipo', {
    is: 'ajuste',
    then: Joi.number().invalid(0).min(-MAX_MOVIMIENTO_CANTIDAD).max(MAX_MOVIMIENTO_CANTIDAD).required(),
    otherwise: Joi.number().greater(0).max(MAX_MOVIMIENTO_CANTIDAD).required(),
  }).label('cantidad'),
  motivo: Joi.when('tipo', {
    is: 'ajuste',
    then: Joi.string().trim().min(1).max(500).required(),
    otherwise: Joi.string().trim().max(500).allow('').optional(),
  }).label('motivo'),
}).unknown(false);

export const queryInventarioMovimientoDto = Joi.object({
  itemId: objectId.optional(),
  tipo: Joi.string().valid(...MOVIMIENTO_TIPOS).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(false);
