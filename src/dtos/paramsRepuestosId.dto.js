import Joi from 'joi';

export const paramsRepuestosIdDto = Joi.object({
  id: Joi.string().hex().length(24).required().label('id'),
});
