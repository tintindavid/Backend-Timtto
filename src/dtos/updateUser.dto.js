'use strict';
import Joi from 'joi';

export const updateUserDto = Joi.object({
  firstName: Joi.string().min(1).max(100).optional(),
  lastName: Joi.string().min(1).max(100).optional(),
  email: Joi.string().email().optional(),
  password: Joi.string().min(8).optional(),
  role: Joi.string().valid('admin', 'technician', 'user').optional(),
  roleId: Joi.string().hex().length(24).optional().allow(null),
  phone: Joi.string().optional(),
  city: Joi.string().optional(),
  registroInvima: Joi.string().optional(),
  photo: Joi.string().optional(),
  fileFirma: Joi.string().optional(),
});
