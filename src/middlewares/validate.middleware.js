'use strict';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

/**
 * Per-detail-type overrides for Joi validation errors that must surface as a
 * distinct HTTP error code instead of the generic `VALIDATION_ERROR` —
 * e.g. the client-portal signature DTO's async blank-image check (design
 * D4, portal-signature-flow). Keyed by the Joi error `type` set via
 * `helpers.error('<type>')` inside a DTO's `.custom()`/`.external()`
 * validator. When a validation failure includes one of these types, its
 * code + message win over the generic `VALIDATION_ERROR` response.
 */
const VALIDATION_ERROR_CODE_OVERRIDES = {
  'imagePng.blank': {
    code: 'INVALID_SIGNATURE_IMAGE',
    message: 'La firma parece estar en blanco. Vuelve a firmar o carga una imagen válida.',
  },
};

function handleJoiOutcome(req, res, next, property, error, value) {
  if (!error) {
    req[property] = value;
    return next();
  }

  if (!error.details) {
    // Not a Joi ValidationError (shouldn't normally happen) — let the
    // global error handler deal with it rather than masking it as a
    // generic validation failure.
    return next(error);
  }

  const details = {};
  let override = null;
  error.details.forEach((d) => {
    const key = d.path.join('.') || d.context?.key || 'value';
    const knownOverride = VALIDATION_ERROR_CODE_OVERRIDES[d.type];
    if (knownOverride && !override) override = knownOverride;
    details[key] = (knownOverride ? knownOverride.message : d.message).replace(/["']/g, '');
  });

  try {
    logger.info('Validation failed payload preview', { url: req.originalUrl, property, payload: req[property] });
  } catch (e) { /* ignore logging errors */ }

  if (override) {
    return next(new ApiError(400, override.message, override.code, details));
  }
  return next(new ApiError(400, 'Errores de validación', 'VALIDATION_ERROR', details));
}

export function validate(schema, property = 'body') {
  return (req, res, next) => {
    // Debug: log incoming value being validated
    try {
      logger.debug && logger.debug('Validating request', { url: req.originalUrl, method: req.method, property, valuePreview: Object.keys(req[property] || {}).slice(0, 100) });
    } catch (e) { /* ignore logging errors */ }

    // Most DTOs are fully synchronous — keep calling `schema.validate()` so
    // `next()` fires in the same tick (existing callers/tests rely on this).
    // A schema that carries a Joi `.external()` rule (e.g. the client-portal
    // signature DTO's async sharp-based blank-PNG check, design D4) makes
    // `.validate()` throw synchronously ("Schema with external rules must
    // use validateAsync()") — fall back to the async path only then.
    try {
      const { error, value } = schema.validate(req[property], { abortEarly: false });
      return handleJoiOutcome(req, res, next, property, error, value);
    } catch (syncThrowErr) {
      if (!/external rules must use validateAsync/.test(syncThrowErr?.message || '')) {
        return next(syncThrowErr);
      }
    }

    // Returning the promise chain is harmless for Express (it never awaits
    // middleware return values, only `next()` matters) and lets callers
    // that DO `await validate(schema, prop)(req, res, next)` directly —
    // e.g. tests that drive the chain manually — observe `next()` having
    // already run by the time the await resolves.
    return schema
      .validateAsync(req[property], { abortEarly: false })
      .then((value) => handleJoiOutcome(req, res, next, property, undefined, value))
      .catch((error) => handleJoiOutcome(req, res, next, property, error));
  };
}
