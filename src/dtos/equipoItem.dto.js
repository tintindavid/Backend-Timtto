import Joi from 'joi';

/**
 * DTO para crear/actualizar snapshot de equipo
 */
export const createSnapshotDto = Joi.object({
  reportId: Joi.string().required(),
  ItemId: Joi.string().required(),
  Marca: Joi.string().optional(),
  Modelo: Joi.string().optional(),
  Serie: Joi.string().optional(),
  Inventario: Joi.string().optional(),
  Ubicacion: Joi.string().optional(),
  SedeId: Joi.string().optional(),
  Servicio: Joi.string().optional(),
  Riesgo: Joi.string().optional().allow('', null),
  Invima: Joi.string().optional().allow('', null),
  mesesMtto: Joi.array()
    .items(
      Joi.string().valid(
        'ene', 'feb', 'mar', 'abr', 'may', 'jun',
        'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
      )
    )
    .optional(),
}).messages({
  'any.required': 'El campo {#label} es requerido',
  'string.base': 'El campo {#label} debe ser texto',
  'array.base': 'El campo {#label} debe ser un array',
});