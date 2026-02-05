import Joi from 'joi';

export const createSedesDto = Joi.object({
  Cliente: Joi.string().hex().length(24).required().label('Cliente'),
  contact: Joi.string().trim().required().label('contact'),
  departamento: Joi.string().trim().required().label('departamento'),
  nombreSede: Joi.string().trim().required().label('nombreSede'),
  telefono: Joi.string().trim().required().label('telefono'),
  ciudad: Joi.string().trim().allow('', null).optional().label('ciudad'),
  direccion: Joi.string().trim().allow('', null).optional().label('direccion'),
  StatusReason: Joi.string().trim().allow('', null).optional().label('StatusReason'),
  tenantId: Joi.string().trim().optional(),
}).unknown(true);



