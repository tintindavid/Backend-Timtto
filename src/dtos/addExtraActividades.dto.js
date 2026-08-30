'use strict';
import Joi from 'joi';

/**
 * POST /api/v1/reportes/:reporteId/actividades-extra
 * Batch-append activities from the tenant's ActividadMtto catalog to a
 * report as "extras" (report-actividades-extra, tasks.md 3.1).
 */
export const addExtraActividadesDto = Joi.object({
  actividadMttoIds: Joi.array()
    .items(
      Joi.string().hex().length(24).messages({
        'string.hex': 'Cada actividadMttoId debe ser un ObjectId válido',
        'string.length': 'Cada actividadMttoId debe ser un ObjectId válido',
      })
    )
    .min(1)
    .max(20)
    .required()
    .messages({
      'array.min': 'Debe incluir al menos una actividad',
      'array.max': 'No se pueden agregar más de 20 actividades en una sola solicitud',
      'any.required': 'actividadMttoIds es requerido',
    })
    .label('actividadMttoIds'),
});
