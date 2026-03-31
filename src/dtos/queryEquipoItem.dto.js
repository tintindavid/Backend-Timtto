import Joi from 'joi';

export const queryEquipoItemDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(2000).default(200),
  sortBy: Joi.string().default('createdAt'),
  order: Joi.string().valid('asc','desc').default('desc'),
  search: Joi.string().optional(),
  Cliente: Joi.string().hex().length(24).optional(),
  ClienteId: Joi.string().hex().length(24).optional(),
});
