import Joi from 'joi';

export const updateSedesDto = Joi.object({
  Cliente: Joi.string().hex().length(24).optional().label('Cliente'),
  contact: Joi.string().trim().optional().label('contact'),
  departamento: Joi.string().trim().optional().label('departamento'),
  nombreSede: Joi.string().trim().optional().label('nombreSede'),
  telefono: Joi.string().trim().optional().label('telefono'),
  ciudad: Joi.string().trim().allow('', null).optional().label('ciudad'),
  direccion: Joi.string().trim().allow('', null).optional().label('direccion'),
  StatusReason: Joi.string().trim().allow('', null).optional().label('StatusReason'),
  tenantId: Joi.string().trim().optional(),
}).min(1).unknown(true);

