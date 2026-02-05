import Joi from 'joi';

export const updateActividadMttoDto = Joi.object({
  Nombre: Joi.string().trim().optional(),
  Descripcion: Joi.string().allow('').optional(),
  EsObligatoria: Joi.boolean().optional(),
  tenantId: Joi.string().optional(),
}).min(1).unknown(true);
