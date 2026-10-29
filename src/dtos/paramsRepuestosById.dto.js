import Joi from 'joi';

// `/repuestos/:id`: a malformed id is a 400, not a Mongoose CastError turned into a 500.
export const paramsRepuestosByIdDto = Joi.object({
  id: Joi.string().hex().length(24).required().label('id'),
});
