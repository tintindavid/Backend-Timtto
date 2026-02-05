'use strict';
import Joi from 'joi';

export const loginUserDto = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(1).required(),
});
