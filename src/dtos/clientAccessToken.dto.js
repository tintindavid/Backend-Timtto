'use strict';
import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

/** POST /api/client-tokens */
export const createClientAccessTokenDto = Joi.object({
  clienteId: objectId.required(),
  otIds: Joi.array().items(objectId.required()).min(1).required(),
  // Optional: user whose signature will appear on the future HTs
  // (2026-08-03). Defaults to the caller if omitted. Service validates
  // that this user has fileFirma before persisting.
  attributionUserId: objectId.optional(),
}).unknown(false);

/** GET /api/client-tokens */
export const queryClientAccessTokensDto = Joi.object({
  clienteId: objectId.optional(),
  status: Joi.string().valid('active', 'revoked').optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
}).unknown(false);
