'use strict';
import Joi from 'joi';

export const queryUserDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'firstName', 'email').default('createdAt'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  search: Joi.string().optional(),
  role: Joi.string().valid('admin', 'technician', 'user').optional(),
  fields: Joi.string().optional(),
  populate: Joi.string().optional(),
});
