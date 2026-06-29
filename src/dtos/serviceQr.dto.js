'use strict';
import Joi from 'joi';
import {
  QR_PASSWORD_MIN,
  QR_PASSWORD_MAX,
  QR_PASSWORD_REGEX,
} from '../constants/serviceQr.constants.js';

const objectId = Joi.string().hex().length(24);

const passwordSchema = Joi.string()
  .min(QR_PASSWORD_MIN)
  .max(QR_PASSWORD_MAX)
  .pattern(QR_PASSWORD_REGEX)
  .required()
  .messages({
    'string.pattern.base':
      'password must be 8..32 chars and include at least one lowercase letter, one uppercase letter and one digit',
  });

/** POST /api/service-qrs */
export const createServiceQrDto = Joi.object({
  ClienteId: objectId.required(),
  sedeId: objectId.required(),
  servicioId: objectId.required(),
  password: passwordSchema,
});

/** PATCH /api/service-qrs/:id/rotate-password */
export const rotateServiceQrPasswordDto = Joi.object({
  newPassword: passwordSchema,
});

/** GET /api/service-qrs */
export const queryServiceQrsDto = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
  ClienteId: objectId.optional(),
  sedeId: objectId.optional(),
  servicioId: objectId.optional(),
  active: Joi.boolean().optional(),
  search: Joi.string().allow('').optional(),
  sortBy: Joi.string().optional(),
  order: Joi.string().valid('asc', 'desc').optional(),
}).unknown(false);

/** POST /public/tickets/validate-access */
export const validateAccessDto = Joi.object({
  qrToken: Joi.string().min(8).max(64).required(),
  password: Joi.string().min(1).max(128).required(),
});
