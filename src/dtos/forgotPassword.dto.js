'use strict';
import Joi from 'joi';

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'El email no es válido',
    'string.empty': 'El email es requerido',
    'any.required': 'El email es requerido',
  }),
}).unknown(false);
