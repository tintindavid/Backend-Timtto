import Joi from 'joi';

export const createTipoRequisicionDto = Joi.object({
  nombre: Joi.string().trim().min(1).max(120).required().label('nombre'),
  codigo: Joi.string().trim().min(1).max(30).required().label('codigo'),
  descripcion: Joi.string().trim().allow('').max(500).optional().label('descripcion'),
  activo: Joi.boolean().optional().label('activo'),
}).unknown(false);

// `codigo` is immutable.
export const updateTipoRequisicionDto = Joi.object({
  nombre: Joi.string().trim().min(1).max(120).optional().label('nombre'),
  descripcion: Joi.string().trim().allow('').max(500).optional().label('descripcion'),
  activo: Joi.boolean().optional().label('activo'),
}).unknown(false).min(1);

export const TIPO_REQUISICION_SORT_FIELDS = Object.freeze(['nombre', 'codigo', 'createdAt']);

export const queryTipoRequisicionDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid(...TIPO_REQUISICION_SORT_FIELDS).default('nombre'),
  order: Joi.string().valid('asc', 'desc').default('asc'),
  search: Joi.string().trim().max(100).allow('').optional(),
  activo: Joi.boolean().truthy('true').falsy('false').optional(),
}).unknown(false);
