'use strict';
import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const addOtsToClientTokenDto = Joi.object({
  otIds: Joi.array().items(objectId.required()).min(1).required(),
}).unknown(false);

export default addOtsToClientTokenDto;
