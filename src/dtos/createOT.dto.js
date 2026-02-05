import Joi from 'joi';

export const createOTDto = Joi.object({
  Consecutivo: Joi.string().trim().optional().label('Consecutivo'),
  ClienteId: Joi.string().hex().length(24).required().label('ClienteId'),
  EstadoOt: Joi.string().trim().optional().label('EstadoOt'),
  FechaCreacion: Joi.date().iso().optional().label('FechaCreacion'),
  TipoServicio: Joi.string().valid('Preventivo', 'Correctivo', 'Predictivo', 'Instalacion', 'Proactivo').required().label('TipoServicio'),
  Avance: Joi.number().optional().label('Avance'),
  EstadoText: Joi.string().trim().optional().label('EstadoText'),
  numeroOt: Joi.number().optional().label('numeroOt'),
  OtPrioridad: Joi.string().valid('Baja', 'Media', 'Alta', 'Urgente').required().label('OtPrioridad'),
  ResponsableId: Joi.string().hex().length(24).optional().label('ResponsableId'),
  reportes: Joi.array().items(Joi.string().hex().length(24)).optional().label('reportes'),
  tenantId: Joi.string().trim().optional(),
}).unknown(true);
 
