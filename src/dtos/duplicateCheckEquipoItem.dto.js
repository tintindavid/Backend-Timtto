import Joi from 'joi';

/**
 * DTO para GET /equipo-items/duplicate-check (query params).
 * ItemId es opcional: sin ItemId el chequeo de duplicado no se aplica
 * (equipo-duplicate-detection-and-replace, design.md D8).
 */
export const duplicateCheckEquipoItemDto = Joi.object({
  ClienteId: Joi.string().hex().length(24).required().label('ClienteId'),
  ItemId: Joi.string().hex().length(24).optional().label('ItemId'),
  Marca: Joi.string().trim().required().label('Marca'),
  Serie: Joi.string().trim().allow('').required().label('Serie'),
});
