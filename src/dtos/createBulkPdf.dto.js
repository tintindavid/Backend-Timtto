'use strict';
import Joi from 'joi';

export const createBulkPdfDto = Joi.object({
  reportIds: Joi.array().items(Joi.string().trim()).optional(),
  filters: Joi.object().optional(),
  otId: Joi.string().optional(),
  sheetworkId: Joi.string().optional(),
});
