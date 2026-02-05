import Joi from 'joi';

export const createCustomerDto = Joi.object({
  Razonsocial: Joi.string().trim().required(),
  Ciudad: Joi.string().trim().required(),
  Departamento: Joi.string().trim().required(),
  Email: Joi.string().trim().email().required(),
  Nit: Joi.number().required(),
  Direccion: Joi.string().trim().allow('', null),
  Logo: Joi.string().trim().allow('', null),
  TelContacto: Joi.string().trim().allow('', null),
  UserContacto: Joi.string().trim().allow('', null),
  // tenantId is resolved by middleware; allow if provided
  tenantId: Joi.string().trim().optional(),
}).unknown(true);
