'use strict';
import Joi from 'joi';

export const createUserDto = Joi.object({
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().min(1).max(100).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid('admin', 'technician', 'user').default('technician'),
  phone: Joi.string().optional(),
  city: Joi.string().optional(),
  registroInvima: Joi.string().optional(),
  photo: Joi.string().optional(),
});
