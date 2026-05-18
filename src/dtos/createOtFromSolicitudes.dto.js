import Joi from 'joi';

export const createOtFromSolicitudesDto = Joi.object({
  repuestoIds: Joi.array().items(Joi.string().hex().length(24)).min(1).required().label('repuestoIds'),
  ResponsableId: Joi.string().hex().length(24).required().label('ResponsableId'),
  FechaEstimadaEntrega: Joi.date().optional().label('FechaEstimadaEntrega'),
  observacion: Joi.string().allow('').optional().label('observacion'),
  OtPrioridad: Joi.string().valid('Baja', 'Media', 'Alta', 'Urgente').optional().label('OtPrioridad'),
  tenantId: Joi.string().optional(),
});
