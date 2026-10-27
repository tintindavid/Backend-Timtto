'use strict';
import Joi from 'joi';

/** `:id` route parameter: a 24-hex ObjectId (an invalid value is a 400, never a Mongoose CastError). */
export const objectIdParamDto = Joi.object({
  id: Joi.string().hex().length(24).required().label('id'),
}).unknown(false);
