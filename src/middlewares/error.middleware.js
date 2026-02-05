'use strict';
import { ApiError } from '../utils/apiError.util.js';
import { errorResponse } from '../utils/apiResponse.util.js';
import { logger } from '../config/logger.config.js';

export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    logger.warn(err.message, { code: err.code, details: err.details });
    return res.status(err.statusCode).json(errorResponse(err.message, err.code, err.details));
  }

  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  return res.status(500).json(errorResponse('Error interno del servidor', 'INTERNAL_ERROR'));
}
