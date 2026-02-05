import Joi from 'joi';

export const updateEquipoItemDto = Joi.object({
  ClienteId: Joi.string().hex().length(24).optional().label('ClienteId'),
  Estado: Joi.string().trim().optional().label('Estado'),
  ItemId: Joi.string().hex().length(24).optional().label('ItemId'),
  Marca: Joi.string().trim().optional().label('Marca'),
  SedeId: Joi.string().hex().length(24).optional().label('SedeId'),
  Serie: Joi.string().trim().optional().label('Serie'),
  Servicio: Joi.string().hex().length(24).optional().label('Servicio'),
  Ubicacion: Joi.string().trim().optional().label('Ubicacion'),
  Inventario: Joi.string().trim().optional().label('Inventario'),
  item: Joi.string().trim().optional().label('item'),
  mesesMtto: Joi.array().items(Joi.string().trim()).optional().label('mesesMtto'),
  Modelo: Joi.string().trim().optional().label('Modelo'),
  UltimoMtto: Joi.date().iso().optional().label('UltimoMtto'),
  tenantId: Joi.string().trim().optional(),
}).min(1).unknown(true);



