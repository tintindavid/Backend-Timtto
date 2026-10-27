import Joi from 'joi';
import { AREA_MAX_JEFES } from '../constants/requisicion.constants.js';

const objectId = Joi.string().hex().length(24);
const jefesIds = Joi.array().items(objectId).max(AREA_MAX_JEFES).unique().label('jefesIds');

// tenantId is never accepted; `codigo` is immutable so it only exists on create.
export const createAreaDto = Joi.object({
  nombre: Joi.string().trim().min(1).max(120).required().label('nombre'),
  codigo: Joi.string().trim().min(1).max(30).required().label('codigo'),
  descripcion: Joi.string().trim().allow('').max(500).optional().label('descripcion'),
  jefesIds: jefesIds.optional(),
  activa: Joi.boolean().optional().label('activa'),
}).unknown(false);

export const updateAreaDto = Joi.object({
  nombre: Joi.string().trim().min(1).max(120).optional().label('nombre'),
  descripcion: Joi.string().trim().allow('').max(500).optional().label('descripcion'),
  jefesIds: jefesIds.optional(),
  activa: Joi.boolean().optional().label('activa'),
}).unknown(false).min(1);

export const AREA_SORT_FIELDS = Object.freeze(['nombre', 'codigo', 'createdAt']);

export const queryAreaDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid(...AREA_SORT_FIELDS).default('nombre'),
  order: Joi.string().valid('asc', 'desc').default('asc'),
  search: Joi.string().trim().max(100).allow('').optional(),
  activa: Joi.boolean().truthy('true').falsy('false').optional(),
}).unknown(false);
