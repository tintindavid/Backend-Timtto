import Joi from 'joi';

export const updateOTDto = Joi.object({
  Consecutivo: Joi.string().trim().optional().label('Consecutivo'),
  ClienteId: Joi.string().hex().length(24).optional().label('ClienteId'),
  EstadoOt: Joi.string().trim().optional().label('EstadoOt'),
  FechaCreacion: Joi.date().iso().optional().label('FechaCreacion'),
  Norden: Joi.string().trim().optional().label('Norden'),
  TipoServicio: Joi.string().valid('Preventivo', 'Correctivo', 'Predictivo', 'Instalacion', 'Proactivo').optional().label('TipoServicio'),
  Avance: Joi.number().optional().label('Avance'),
  EstadoText: Joi.string().trim().optional().label('EstadoText'),
  numeroOt: Joi.number().optional().label('numeroOt'),
  OtPrioridad: Joi.string().valid('Baja', 'Media', 'Alta', 'Urgente').optional().label('OtPrioridad'),
  ResponsableId: Joi.string().hex().length(24).optional().label('ResponsableId'),
  reportes: Joi.array().items(Joi.string().hex().length(24)).optional().label('reportes'),
  tenantId: Joi.string().trim().optional(),
}).min(1).unknown(true);
 
