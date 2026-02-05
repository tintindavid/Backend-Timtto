import Joi from 'joi';

export const createItemsDto = Joi.object({
    Nombre: Joi.string().trim().required().label('Nombre'),
    Observacion: Joi.string().allow('').optional().label('Observacion'),
    tenantId: Joi.string().optional(),
    ProtocoloId: Joi.string().hex().length(24).required().label('ProtocoloId'),
});
