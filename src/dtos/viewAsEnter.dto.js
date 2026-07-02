import Joi from 'joi';

/**
 * DTO for POST /api/v1/platform/view-as.
 * Validates the tenantId the SuperAdmin wants to view as.
 *
 * The sentinel '__platform__' is explicitly rejected — SuperAdmin should not
 * "view as" the platform itself.
 */
export const viewAsEnterSchema = Joi.object({
  tenantId: Joi.string()
    .trim()
    .lowercase()
    .required()
    .invalid('__platform__')
    .messages({
      'string.empty': 'tenantId es requerido',
      'any.required': 'tenantId es requerido',
      'any.invalid': 'No se puede usar el tenantId de la plataforma como target de view-as',
    }),
}).unknown(false);
