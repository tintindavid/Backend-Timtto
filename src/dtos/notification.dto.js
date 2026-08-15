'use strict';
import Joi from 'joi';

/** GET /api/v1/notifications */
export const queryNotificationsDto = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  unread: Joi.boolean().truthy('true').falsy('false').optional(),
}).unknown(false);
