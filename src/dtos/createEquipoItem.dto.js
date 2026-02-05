import Joi from 'joi';

export const createEquipoItemDto = Joi.object({
  ClienteId: Joi.string().hex().length(24).required().label('ClienteId'),
  Estado: Joi.string().trim().required().label('Estado'),
  ItemId: Joi.string().hex().length(24).required().label('ItemId'),
  Marca: Joi.string().trim().required().label('Marca'),
  SedeId: Joi.string().hex().length(24).required().label('SedeId'),
  Serie: Joi.string().trim().required().label('Serie'),
  Servicio: Joi.string().hex().length(24).required().label('Servicio'),
  Ubicacion: Joi.string().trim().optional().label('Ubicacion'),
  Cronograma: Joi.string().trim().optional().label('Cronograma'),
  Inventario: Joi.string().trim().optional().label('Inventario'),
  mesesMtto: Joi.array().items(Joi.string().trim()).optional().label('mesesMtto'),
  Modelo: Joi.string().trim().optional().label('Modelo'),
  tenantId: Joi.string().optional(),
}).unknown(true);



