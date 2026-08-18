import Joi from 'joi';

/**
 * Payload for `POST /repuestos/ot-from-solicitudes`.
 * The OT is always TipoServicio: 'Correctivo'. Responsables are multi-select
 * (max 5) and get assigned as the OT's first `programaciones[]` active entry,
 * mirroring the /maintenance-orders Responsables modal. Optional `nota` seeds
 * `notas[0]` on the newly-created OT.
 */
export const createOtFromSolicitudesDto = Joi.object({
  repuestoIds: Joi.array().items(Joi.string().hex().length(24)).min(1).required().label('repuestoIds'),
  responsableUserIds: Joi.array().items(Joi.string().hex().length(24)).min(1).max(5).required().label('responsableUserIds'),
  fechaInicio: Joi.date().iso().required().label('fechaInicio'),
  fechaFin: Joi.date().iso().min(Joi.ref('fechaInicio')).required().label('fechaFin'),
  nota: Joi.string().trim().allow('').max(2000).optional().label('nota'),
  OtPrioridad: Joi.string().valid('Baja', 'Media', 'Alta', 'Urgente').optional().label('OtPrioridad'),
  tenantId: Joi.string().optional(),
});
