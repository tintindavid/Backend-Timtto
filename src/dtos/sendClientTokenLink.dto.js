'use strict';
import Joi from 'joi';

export const sendClientTokenLinkDto = Joi.object({
  email: Joi.string().email({ minDomainSegments: 2 }).trim().lowercase().required(),
}).unknown(false);

export default sendClientTokenLinkDto;
