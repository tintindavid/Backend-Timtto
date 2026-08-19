import Joi from 'joi';

/**
 * DTO para POST /equipo-items/duplicate-check/bulk.
 * Capped at 500 items so validation rejects oversized payloads cheaply,
 * before the service runs any query (equipo-duplicate-detection-and-replace).
 */
export const duplicateCheckBulkEquipoItemDto = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        rowId: Joi.string().required().label('rowId'),
        ClienteId: Joi.string().hex().length(24).required().label('ClienteId'),
        ItemId: Joi.string().hex().length(24).optional().label('ItemId'),
        Marca: Joi.string().trim().required().label('Marca'),
        Serie: Joi.string().trim().allow('').required().label('Serie'),
      })
    )
    .max(500)
    .required()
    .label('items')
    .messages({
      'array.max': 'El campo items no puede tener más de 500 elementos',
    }),
});
