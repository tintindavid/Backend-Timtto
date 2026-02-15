import Joi from 'joi';

export const updateItemsDto = Joi.object({
      Nombre: Joi.string().trim().optional().label('Nombre'),
      Observacion: Joi.string().allow('').optional().label('Observacion'),
      tenantId: Joi.string().optional(),
      Precio: Joi.number().allow('', null).optional().label('Precio'),
      IvaIncluido: Joi.boolean().optional().label('IvaIncluido'),
      Iva: Joi.number().allow('', null).optional().label('Iva'),
      ProtocoloId: Joi.string().hex().length(24).optional().label('ProtocoloId'),
}).min(1).unknown(true);
