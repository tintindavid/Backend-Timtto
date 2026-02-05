import Joi from 'joi';

export const updateProtocoloMttoDto = Joi.object({
  nombre: Joi.string().trim().optional(),
  Descripcion: Joi.string().allow('').optional(),
  tenantId: Joi.string().optional(),
  actividadesMtto: Joi.array().items(Joi.string().hex().length(24)).optional(),
}).min(1).unknown(true);
