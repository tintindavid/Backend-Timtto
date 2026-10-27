import Joi from 'joi';
import { PERIODO_REGEX } from '../constants/requisicion.constants.js';

const objectId = Joi.string().hex().length(24);
const periodo = Joi.string().trim().pattern(PERIODO_REGEX).messages({ 'string.pattern.base': 'periodo debe ser YYYY o YYYY-MM' });

// The currency is the tenant's base currency, forced by the server: it is never accepted from the body.
export const createPresupuestoAreaDto = Joi.object({
  areaId: objectId.required().label('areaId'),
  periodo: periodo.required().label('periodo'),
  monto: Joi.number().min(0).required().label('monto'),
  umbralAlerta: Joi.number().min(1).max(100).optional().label('umbralAlerta'),
}).unknown(false);

// Area and period identify the budget and do not change.
export const updatePresupuestoAreaDto = Joi.object({
  monto: Joi.number().min(0).optional().label('monto'),
  umbralAlerta: Joi.number().min(1).max(100).optional().label('umbralAlerta'),
}).unknown(false).min(1);

export const queryPresupuestoAreaDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  areaId: objectId.optional(),
  periodo: periodo.optional().label('periodo'),
}).unknown(false);

export const resumenPresupuestoDto = Joi.object({
  areaId: objectId.required().label('areaId'),
  periodo: periodo.required().label('periodo'),
}).unknown(false);
