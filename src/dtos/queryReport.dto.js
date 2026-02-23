import Joi from 'joi';

export const queryReportDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(500).default(100),
  sortBy: Joi.string().default('createdAt'),
  order: Joi.string().valid('asc','desc').default('desc'),
  search: Joi.string().optional(),
});
