'use strict';
import Joi from 'joi';
import { SHEET_SIGN_MESSAGE_MAX } from '../constants/sheetwork.constants.js';

const objectId = Joi.string().hex().length(24);

export const remoteSignRequestDto = Joi.object({
  otId: objectId.required(),
  reportIds: Joi.array().items(objectId.required()).min(1).required(),
  email: Joi.string().email({ minDomainSegments: 2 }).trim().lowercase().required(),
  message: Joi.string().trim().max(SHEET_SIGN_MESSAGE_MAX).allow('').optional(),
}).unknown(false);

export default remoteSignRequestDto;
