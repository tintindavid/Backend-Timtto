'use strict';

import Joi from 'joi';
import { PERMISSION_VALUES } from '../constants/permissions.js';

const permissionSchema = Joi.array().items(Joi.string().valid(...PERMISSION_VALUES)).min(1).required();

export const createRoleDto = Joi.object({
  name: Joi.string().min(1).max(120).required(),
  description: Joi.string().allow('').optional(),
  permissions: permissionSchema,
  isDefault: Joi.boolean().optional().default(false),
});

export const updateRoleDto = Joi.object({
  name: Joi.string().min(1).max(120).optional(),
  description: Joi.string().allow('').optional(),
  permissions: Joi.array().items(Joi.string().valid(...PERMISSION_VALUES)).min(1).optional(),
  isDefault: Joi.boolean().optional(),
}).min(1);