import Joi from 'joi';

export const queryRepuestosDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().default('createdAt'),
  order: Joi.string().valid('asc','desc').default('desc'),
  search: Joi.string().empty('').optional(),
  estado: Joi.string().empty('').optional().label('estado'),
  clienteId: Joi.string().hex().length(24).empty('').optional().label('clienteId'),
});
