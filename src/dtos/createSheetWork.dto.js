import Joi from 'joi';
import { report } from 'process';

export const createSheetWorkDto = Joi.object({
  otId: Joi.string().hex().length(24).required(),
  clienteId: Joi.string().hex().length(24).optional(),
  reports: Joi.array().items(Joi.string().hex().length(24)).min(1).required(),
  numeroHoja: Joi.alternatives().try(Joi.number().integer(), Joi.string()).optional(),
  estado: Joi.string().optional(),
  fechaCreacion: Joi.string().isoDate().optional(),
  personaRecibe: Joi.string().max(200).optional(),
  cargoRecibe: Joi.string().max(200).optional(),
  firmaFile: Joi.string().optional(),
  reportPayload: Joi.object().optional(),
  responsable: Joi.string().hex().length(24),
  fullNameResponsable: Joi.string().max(200).optional(),
  cargoResponsable: Joi.string().max(200).optional(),
  firmaResponsableFile: Joi.string().optional(),
}).required();
