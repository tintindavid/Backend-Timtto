'use strict';
import Joi from 'joi';
import { PDF_FILENAME_TOKENS } from '../constants/pdfReports.constants.js';

const objectId = Joi.string().hex().length(24);

const fileNameConfigSchema = Joi.object({
  tokens: Joi.array()
    .items(Joi.string().valid(...PDF_FILENAME_TOKENS))
    .min(1)
    .max(PDF_FILENAME_TOKENS.length)
    .unique()
    .required(),
}).unknown(false);

/**
 * Body validation for `POST /api/v1/pdf-reports/bulk`. Keeps every historical
 * field optional (`reportIds`, `filters`, `otId`, `sheetworkId`) — the
 * controller already handles the "at least one of these" rule with a 400
 * response, so we don't duplicate that here.
 *
 * The new addition is `fileNameConfig`, optional. When present, its `tokens`
 * MUST be a non-empty, unique subset of PDF_FILENAME_TOKENS.
 */
export const bulkPdfReportsDto = Joi.object({
  reportIds: Joi.array().items(objectId).optional(),
  filters: Joi.object().unknown(true).optional(),
  otId: objectId.optional(),
  sheetworkId: objectId.optional(),
  fileNameConfig: fileNameConfigSchema.optional(),
}).unknown(false);

export default bulkPdfReportsDto;
