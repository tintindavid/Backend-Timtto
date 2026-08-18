import Joi from 'joi';

/**
 * Accent-insensitive matcher for TipoServicio. The Mongoose model accepts
 * BOTH the ASCII (`Instalacion`) and the tilde (`Instalación`) variants
 * for retro-compat with historical data, and the frontend `<option>` list
 * uses the tilde form. Direct `.valid(...)` in Joi is byte-exact and can
 * fail on Unicode normalization mismatches (NFC vs NFD, or different UTF-8
 * encodings between browser/proxy/body-parser). This custom validator
 * normalizes the incoming value to NFC, strips diacritics, and matches
 * against a canonical ASCII list. The RETURNED value keeps the input the
 * user typed so the model's enum (which still permits both) stores it as-is.
 */
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
  if (!canonical) {
    return helpers.error('any.invalid');
  }
  return canonical;
}, 'TipoServicio accent-insensitive validator').messages({
  'any.invalid': 'TipoServicio debe ser uno de: Preventivo, Correctivo, Predictivo, Instalación, Proactivo, Diagnóstico',
});

export const createOTDto = Joi.object({
  Consecutivo: Joi.string().trim().optional().label('Consecutivo'),
  ClienteId: Joi.string().hex().length(24).required().label('ClienteId'),
  EstadoOt: Joi.string().trim().optional().label('EstadoOt'),
  FechaCreacion: Joi.date().iso().optional().label('FechaCreacion'),
  TipoServicio: tipoServicioSchema.required().label('TipoServicio'),
  Avance: Joi.number().optional().label('Avance'),
  EstadoText: Joi.string().trim().optional().label('EstadoText'),
  numeroOt: Joi.number().optional().label('numeroOt'),
  OtPrioridad: Joi.string().valid('Baja', 'Media', 'Alta', 'Urgente').required().label('OtPrioridad'),
  ResponsableId: Joi.string().hex().length(24).optional().label('ResponsableId'),
  reportes: Joi.array().items(Joi.string().hex().length(24)).optional().label('reportes'),
  tenantId: Joi.string().trim().optional(),
}).unknown(true);
 
