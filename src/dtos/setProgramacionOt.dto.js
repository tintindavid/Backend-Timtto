import Joi from 'joi';

/**
 * POST /api/v1/ots/:id/programacion body (ot-responsables-programacion-trazable,
 * tasks.md 4.1). Structural validation only — the "start date must not be in
 * the past unless unchanged" rule (spec Requirement "Date validation on
 * programación") depends on the OT's currently-active entry and is enforced
 * in ot.service.js#setProgramacion, not here.
 */
export const setProgramacionOtDto = Joi.object({
  fechaInicio: Joi.date().iso().required(),
  fechaFin: Joi.date().iso().required().greater(Joi.ref('fechaInicio')),
  responsableUserIds: Joi.array().items(Joi.string().hex().length(24)).min(1).max(5).required(),
}).required();
