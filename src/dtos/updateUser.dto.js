'use strict';
import Joi from 'joi';

export const updateUserDto = Joi.object({
  firstName: Joi.string().min(1).max(100).optional(),
  lastName: Joi.string().min(1).max(100).optional(),
  email: Joi.string().email().optional(),
  password: Joi.string().min(8).optional(),
  role: Joi.string().valid('admin', 'technician', 'user').optional(),
  roleId: Joi.string().hex().length(24).optional().allow(null),
  phone: Joi.string().allow('').optional(),
  city: Joi.string().allow('').optional(),
  registroInvima: Joi.string().allow('').optional(),
  photo: Joi.string().allow('').optional(),
  fileFirma: Joi.string().allow('').optional(),
  fechaNacimiento: Joi.date().optional().allow(null, ''),
  fechaIngreso: Joi.date().optional().allow(null, ''),
  tipoContrato: Joi.string().valid(
    'Indefinido', 'Fijo', 'Prestacion de servicios', 'Obra o labor', 'Aprendizaje', 'Practicas', 'Temporal', '',
  ).optional(),
  salario: Joi.number().min(0).optional().allow(null),
});
