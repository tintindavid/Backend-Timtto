import Joi from 'joi';

/**
 * DTO para validar consulta de equipos por mes de mantenimiento
 */
export const queryEquipoByMesDto = Joi.object({
  mes: Joi.string()
    .valid('ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic')
    .required()
    .messages({
      'string.base': 'El mes debe ser un string',
      'any.required': 'El parámetro mes es requerido',
      'any.only': 'El mes debe ser un valor válido (ene, feb, mar, abr, may, jun, jul, ago, sep, oct, nov, dic)'
    })
});
