import Joi from 'joi';
import { isValidActivityOrigin } from '../utils/activityOrigin.util.js';

/**
 * Sub-doc shape for `actividadesRealizadas[i]` (report-actividades-extra,
 * tasks.md 3.2/3.3). Known fields are enumerated for documentation, but
 * `.unknown(true)` keeps this additive over the pre-existing untyped
 * payload (frontend has historically sent extra fields like `actividad`,
 * `nombre`, `duracion` — see TimttoFrontend/src/types/reporte.types.ts).
 * The `.custom()` below enforces the shared origin invariant (spec: "Report
 * sub-document integrity for activities") on every item — the same helper
 * used by report.service.js so both write paths never diverge.
 */
const actividadRealizadaItemDto = Joi.object({
  _id: Joi.string().optional(),
  actividadProtocoloId: Joi.string().allow('', null).optional(),
  actividadMttoId: Joi.string().hex().length(24).allow(null).optional(),
  descripcion: Joi.string().allow('', null).optional(),
  descripcionLarga: Joi.string().allow('', null).optional(),
  realizado: Joi.boolean().optional(),
  esExtra: Joi.boolean().optional(),
  fecha: Joi.date().allow(null).optional(),
  observaciones: Joi.string().allow('', null).optional(),
  duracion: Joi.number().optional(),
})
  .unknown(true)
  .custom((value, helpers) => {
    if (!isValidActivityOrigin(value)) return helpers.error('activityOrigin.invalid');
    return value;
  }, 'activity origin invariant');

export const updateReportDto = Joi.object({
  procesado: Joi.boolean().optional().label('procesado'),
  fechaProcesado: Joi.date().optional().label('fechaProcesado'),
  // Allow commonly updated fields
  estado: Joi.string().optional().label('estado'),
  MotivoFueraDeServicio: Joi.string().allow('').optional().label('MotivoFueraDeServicio'),
  fechaFinalizdo: Joi.date().optional().label('fechaFinalizdo'),
  hojaDeTrabajo: Joi.string().hex().length(24).optional().label('hojaDeTrabajo'),
  estadoOperativo: Joi.string().valid('Operativo', 'Fuera de Servicio', 'En Mantenimiento', 'Espera de Repuestos', 'En Reparacion', 'Dado de Baja').optional().label('estadoOperativo'),
  Observacion: Joi.string().allow('').optional().label('Observacion'),
  CausaEncontrada: Joi.string().allow('').optional().label('CausaEncontrada'),
  fechaCancelacion: Joi.date().optional().label('fechaCancelacion'),
  motivoCancelacion: Joi.string().allow('').optional().label('motivoCancelacion'),
  ResponsableMtto: Joi.object({
    _id: Joi.string().allow('').optional(),
    firstName: Joi.string().optional(),
    lastName: Joi.string().optional(),
  }).optional().label('ResponsableMtto'),
  actividadesRealizadas: Joi.array().items(actividadRealizadaItemDto).optional().label('actividadesRealizadas'),
}).unknown(true); // Permitir campos adicionales sin validarlos