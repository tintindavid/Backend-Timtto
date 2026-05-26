import Joi from 'joi';
import {
  MAX_MAGNITUD_LENGTH,
  MAX_UNIDAD_LENGTH,
  MAX_PATRON_LENGTH,
} from '../constants/verificationParam.constants.js';

const verificationParamItemSchema = Joi.object({
  _id: Joi.string().hex().length(24).optional(),
  magnitud: Joi.string().trim().allow('').max(MAX_MAGNITUD_LENGTH).default('').label('magnitud'),
  unidad: Joi.string().trim().allow('').max(MAX_UNIDAD_LENGTH).default('').label('unidad'),
  valorReferencia: Joi.number().allow(null).default(null).label('valorReferencia'),
  valorMedido: Joi.number().allow(null).default(null).label('valorMedido'),
  patron: Joi.string().trim().allow('').max(MAX_PATRON_LENGTH).default('').label('patron'),
});

export const updateVerificationParamsDto = Joi.object({
  verificationParam: Joi.array().items(verificationParamItemSchema).required().label('verificationParam'),
});
