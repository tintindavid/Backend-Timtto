import Joi from 'joi';
import { CATEGORIAS_DOCUMENTO } from '../constants/hvEquipo.constants.js';

/**
 * Body of the multipart document endpoints. The file itself (field `archivo`)
 * is validated by Multer + magic-bytes in the Firebase service.
 * POST: nombre required. PUT: every field optional (at least handled by controller).
 */
export const uploadDocumentoDto = Joi.object({
  nombre: Joi.string().trim().min(1).max(200).required(),
  link: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(2000).allow('', null).optional(),
  categoria: Joi.string().valid(...CATEGORIAS_DOCUMENTO).optional(),
});

export const updateDocumentoDto = Joi.object({
  nombre: Joi.string().trim().min(1).max(200).optional(),
  link: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(2000).allow('', null).optional(),
  // Immutable after creation: accepted but dropped so a client sending it does not get a 400.
  categoria: Joi.any().strip(),
});
