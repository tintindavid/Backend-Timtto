'use strict';
import Joi from 'joi';

export const informeGenerateByOtDto = Joi.object({
  clienteId: Joi.string().hex().length(24).required().messages({
    'string.hex': 'clienteId must be a valid MongoDB ObjectId',
    'string.length': 'clienteId must be a valid MongoDB ObjectId',
    'any.required': 'clienteId is required',
  }),
  otIds: Joi.array()
    .items(Joi.string().hex().length(24))
    .min(1)
    .max(200)
    .required()
    .messages({
      'array.min': 'otIds must contain at least 1 OT id',
      'array.max': 'otIds must contain at most 200 OT ids — batch the request',
      'any.required': 'otIds is required',
    }),
  observacionGeneral: Joi.string().allow('').max(2000).optional(),
  fotoIds: Joi.array()
    .items(Joi.string().hex().length(24))
    .max(10)
    .unique()
    .optional()
    .messages({
      'array.max': 'fotoIds must contain at most 10 photo ids',
      'string.hex': 'fotoIds must be valid MongoDB ObjectIds',
      'string.length': 'fotoIds must be valid MongoDB ObjectIds',
    }),
  observacionesAdicionalesHtml: Joi.string().allow('').max(20000).optional().messages({
    'string.max': 'observacionesAdicionalesHtml must be at most 20000 characters',
  }),
});

/** Body of POST /informes/por-ot/evidencias (photo candidates, paginated). */
export const informeEvidenciasByOtDto = Joi.object({
  clienteId: informeGenerateByOtDto.extract('clienteId'),
  otIds: informeGenerateByOtDto.extract('otIds'),
  reporteId: Joi.string().hex().length(24).optional(),
  search: Joi.string().allow('').max(100).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(24).default(24),
});

