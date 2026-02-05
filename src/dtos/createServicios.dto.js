import Joi from 'joi';

export const createServiciosDto = Joi.object({
  Cliente: Joi.string().hex().length(24).required().label('Cliente'),
  nombre: Joi.string().trim().required().label('nombre'),
  observacion: Joi.string().trim().allow('', null).optional().label('observacion'),
  tenantId: Joi.string().trim().optional(),
}).unknown(true);



