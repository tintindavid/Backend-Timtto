import Joi from 'joi';

export const createProtocoloMttoDto = Joi.object({
  nombre: Joi.string().trim().required().label('nombre'),
  Descripcion: Joi.string().allow('').optional().label('Descripcion'),
  tenantId: Joi.string().optional(),
  actividadesMtto: Joi.array()
    .items(Joi.string().hex().length(24))
    .optional(),
}).unknown(true);
