import Joi from 'joi';

export const updateCustomerDto = Joi.object({
  Razonsocial: Joi.string().trim().optional(),
  Ciudad: Joi.string().trim().optional(),
  Departamento: Joi.string().trim().optional(),
  Email: Joi.string().trim().email().optional(),
  Nit: Joi.number().optional(),
  Direccion: Joi.string().trim().allow('', null).optional(),
  Logo: Joi.string().trim().allow('', null).optional(),
  TelContacto: Joi.string().trim().allow('', null).optional(),
  UserContacto: Joi.string().trim().allow('', null).optional(),
  tenantId: Joi.string().trim().optional(),
}).min(1);

// Allow unknown fields from frontend payloads (will be handled by model validations)
export const updateCustomerDtoAllowUnknown = updateCustomerDto.unknown(true);
