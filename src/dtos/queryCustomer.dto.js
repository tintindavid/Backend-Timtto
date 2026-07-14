import Joi from 'joi';

export const queryCustomerDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(200),
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'Razonsocial', 'Ciudad', 'Nit').default('createdAt'),
  order: Joi.string().valid('asc','desc').default('desc'),
  // Free-text search across Razonsocial + Ciudad + Email.
  search: Joi.string().allow('').optional(),
  // Field-specific filters for the redesigned Customers page.
  razonSocial: Joi.string().allow('').optional(),
  ciudad: Joi.string().allow('').optional(),
  nit: Joi.string().allow('').optional(),
});
