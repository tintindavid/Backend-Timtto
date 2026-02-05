import Joi from 'joi';

export const paramsRepuestosByEquipoDto = Joi.object({
  equipoId: Joi.string().hex().length(24).required().label('equipoId'),
});
