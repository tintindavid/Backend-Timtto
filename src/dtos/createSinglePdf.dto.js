'use strict';
import Joi from 'joi';

export const createSinglePdfDto = Joi.object({ reportId: Joi.string().required() });
