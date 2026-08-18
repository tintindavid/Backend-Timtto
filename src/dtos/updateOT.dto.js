import Joi from 'joi';

const CANONICAL_TIPO_SERVICIO = new Map([
  ['preventivo', 'Preventivo'],
  ['correctivo', 'Correctivo'],
  ['predictivo', 'Predictivo'],
  ['instalacion', 'Instalación'],
  ['proactivo', 'Proactivo'],
  ['diagnostico', 'Diagnóstico'],
]);

const tipoServicioSchema = Joi.string().trim().custom((value, helpers) => {
  const norm = String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const canonical = CANONICAL_TIPO_SERVICIO.get(norm);
  if (!canonical) return helpers.error('any.invalid');
  return canonical;
}).messages({
  'any.invalid': 'TipoServicio debe ser uno de: Preventivo, Correctivo, Predictivo, Instalación, Proactivo, Diagnóstico',
});

export const updateOTDto = Joi.object({
  Consecutivo: Joi.string().trim().optional().label('Consecutivo'),
  ClienteId: Joi.string().hex().length(24).optional().label('ClienteId'),
  EstadoOt: Joi.string().trim().optional().label('EstadoOt'),
  FechaCreacion: Joi.date().iso().optional().label('FechaCreacion'),
  Norden: Joi.string().trim().optional().label('Norden'),
  TipoServicio: tipoServicioSchema.optional().label('TipoServicio'),
  Avance: Joi.number().optional().label('Avance'),
  EstadoText: Joi.string().trim().optional().label('EstadoText'),
  numeroOt: Joi.number().optional().label('numeroOt'),
  OtPrioridad: Joi.string().valid('Baja', 'Media', 'Alta', 'Urgente').optional().label('OtPrioridad'),
  ResponsableId: Joi.string().hex().length(24).optional().label('ResponsableId'),
  reportes: Joi.array().items(Joi.string().hex().length(24)).optional().label('reportes'),
  tenantId: Joi.string().trim().optional(),
}).min(1).unknown(true);
 
