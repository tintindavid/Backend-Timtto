'use strict';
import Joi from 'joi';

export const informeGenerateByOtDto = Joi.object({
  clienteId: Joi.string().hex().length(24).required().messages({
    'string.hex': 'clienteId must be a valid MongoDB ObjectId',
    'string.length': 'clienteId must be a valid MongoDB ObjectId',
    'any.required': 'clienteId is required',
  }),
  otIds: Joi.array()
    .items(Joi.string().hex().length(24))
    .min(1)
    .max(200)
    .required()
    .messages({
      'array.min': 'otIds must contain at least 1 OT id',
      'array.max': 'otIds must contain at most 200 OT ids — batch the request',
      'any.required': 'otIds is required',
    }),
  observacionGeneral: Joi.string().allow('').max(2000).optional(),
});
