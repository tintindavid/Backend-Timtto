'use strict';
import Joi from 'joi';

export const queryUserDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'firstName', 'lastName', 'email').default('createdAt'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  // Free-text search across name fields — kept for backwards compat.
  search: Joi.string().allow('').optional(),
  // Field-specific filters used by the redesigned Users page. All optional.
  name: Joi.string().allow('').optional(),
  email: Joi.string().allow('').optional(),
  role: Joi.string().valid('admin', 'technician', 'user').optional(),
  roleId: Joi.string().hex().length(24).optional().allow(''),
  fields: Joi.string().optional(),
  populate: Joi.string().optional(),
});
