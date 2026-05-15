import Joi from 'joi';

const MESES_VALIDOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * DTO para generar PDF de cronograma.
 * El backend consulta los equipos en DB a partir del clienteId y filtros opcionales.
 */
export const cronogramaPDFDto = Joi.object({
  clienteId: Joi.string().required(),

  filtros: Joi.object({
    sedeIds: Joi.array().items(Joi.string()).optional(),
    servicioIds: Joi.array().items(Joi.string()).optional(),
    meses: Joi.array().items(Joi.string().valid(...MESES_VALIDOS)).optional(),
    ubicaciones: Joi.array().items(Joi.string()).optional(),
    estado: Joi.string().optional(),
  }).optional(),
}).messages({
  'any.required': 'El campo {#label} es requerido',
  'object.base': 'El campo {#label} debe ser un objeto válido',
  'array.base': 'El campo {#label} debe ser un array',
});
