import Joi from 'joi';

/**
 * DTO for POST /api/v1/auth/change-password.
 * Used by authenticated users (including those with mustChangePassword=true).
 */
export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    'string.empty': 'La contraseña actual es requerida',
    'any.required': 'La contraseña actual es requerida',
  }),
  newPassword: Joi.string().min(8).required().messages({
    'string.min': 'La nueva contraseña debe tener al menos 8 caracteres',
    'string.empty': 'La nueva contraseña es requerida',
    'any.required': 'La nueva contraseña es requerida',
  }),
}).unknown(false);
