import Joi from 'joi';

export const createActividadMttoDto = Joi.object({
  Nombre: Joi.string().trim().required(),
  Descripcion: Joi.string().allow('').optional(),
  EsObligatoria: Joi.boolean().optional(),
  tenantId: Joi.string().optional(),
}).unknown(true);
