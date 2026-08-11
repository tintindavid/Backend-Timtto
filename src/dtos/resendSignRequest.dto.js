'use strict';
import Joi from 'joi';
import { SHEET_SIGN_MESSAGE_MAX } from '../constants/sheetwork.constants.js';

export const resendSignRequestDto = Joi.object({
  email: Joi.string().email({ minDomainSegments: 2 }).trim().lowercase().required(),
  message: Joi.string().trim().max(SHEET_SIGN_MESSAGE_MAX).allow('').optional(),
}).unknown(false);

export default resendSignRequestDto;
