import Joi from 'joi';

export const createItemsDto = Joi.object({
    Nombre: Joi.string().trim().required().label('Nombre'),
    Observacion: Joi.string().allow('').optional().label('Observacion'),
    tenantId: Joi.string().optional(),
    Precio: Joi.number().optional().label('Precio'),
    IvaIncluido: Joi.boolean().optional().label('IvaIncluido'),
    Iva: Joi.number().optional().label('Iva'),
    ProtocoloId: Joi.string().hex().length(24).required().label('ProtocoloId'),
});
