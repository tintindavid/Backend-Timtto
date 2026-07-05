'use strict';
import Joi from 'joi';

export const resetPasswordSchema = Joi.object({
  token: Joi.string().hex().length(64).required().messages({
    'string.length': 'Token inválido',
    'any.required': 'El token es requerido',
  }),
  tenantId: Joi.string().required().messages({
    'string.empty': 'El tenant es requerido',
    'any.required': 'El tenant es requerido',
  }),
  newPassword: Joi.string().min(8).required().messages({
    'string.min': 'La contraseña debe tener al menos 8 caracteres',
    'string.empty': 'La contraseña es requerida',
    'any.required': 'La contraseña es requerida',
  }),
}).unknown(false);
