'use strict';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

export function validate(schema, property = 'body') {
  return (req, res, next) => {
    // Debug: log incoming value being validated
    try {
      logger.debug && logger.debug('Validating request', { url: req.originalUrl, method: req.method, property, valuePreview: Object.keys(req[property] || {}).slice(0, 10) });
    } catch (e) { /* ignore logging errors */ }
    const { error, value } = schema.validate(req[property], { abortEarly: false });
    if (error) {
      const details = {};
      error.details.forEach((d) => {
        const key = d.path.join('.') || d.context?.key || 'value';
        details[key] = d.message.replace(/["']/g, '');
      });
      try {
        logger.info('Validation failed payload preview', { url: req.originalUrl, property, payload: req[property] });
      } catch (e) { /* ignore logging errors */ }
      return next(new ApiError(400, 'Errores de validación', 'VALIDATION_ERROR', details));
    }
    req[property] = value;
    return next();
  };
}
