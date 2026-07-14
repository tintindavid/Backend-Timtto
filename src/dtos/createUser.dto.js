'use strict';
import Joi from 'joi';

export const createUserDto = Joi.object({
  firstName: Joi.string().min(1).max(100).required(),
  lastName: Joi.string().min(1).max(100).required(),
  email: Joi.string().email().required(),
  // Password is optional now — when omitted, the service generates a temporary
  // one, marks mustChangePassword=true and emails it to the new user.
  password: Joi.string().min(8).optional().allow('', null),
  role: Joi.string().valid('admin', 'technician', 'user').default('technician'),
  roleId: Joi.string().hex().length(24).optional().allow(null),
  phone: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  registroInvima: Joi.string().allow('').optional(),
  photo: Joi.string().allow('').optional(),
  fechaNacimiento: Joi.date().optional().allow(null, ''),
  fechaIngreso: Joi.date().optional().allow(null, ''),
  tipoContrato: Joi.string().valid(
    'Indefinido', 'Fijo', 'Prestacion de servicios', 'Obra o labor', 'Aprendizaje', 'Practicas', 'Temporal', '',
  ).optional(),
  salario: Joi.number().min(0).optional().allow(null),
});
