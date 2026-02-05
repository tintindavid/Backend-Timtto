import Joi from 'joi';

export const updateServiciosDto = Joi.object({
  Cliente: Joi.string().hex().length(24).optional().label('Cliente'),
  nombre: Joi.string().trim().optional().label('nombre'),
  observacion: Joi.string().trim().allow('', null).optional().label('observacion'),
  tenantId: Joi.string().trim().optional(),
}).min(1).unknown(true);

