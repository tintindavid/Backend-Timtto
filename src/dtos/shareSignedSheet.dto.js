'use strict';
import Joi from 'joi';

export const shareSignedSheetDto = Joi.object({
  email: Joi.string().email({ minDomainSegments: 2 }).trim().lowercase().required(),
  allowReports: Joi.boolean().optional(),
}).unknown(false);

export default shareSignedSheetDto;
