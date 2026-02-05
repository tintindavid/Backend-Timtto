import Joi from 'joi';

// Body expects partial EquipoItem fields plus a required reportId to update snapshot
export const updateEquipoSnapshotDto = Joi.object({
  reportId: Joi.string().hex().length(24).required().label('reportId'),
  Marca: Joi.string().optional().label('Marca'),
  Serie: Joi.string().allow('').optional().label('Serie'),
  Inventario: Joi.string().allow('').optional().label('Inventario'),
  Ubicacion: Joi.string().optional().label('Ubicacion'),
  Modelo: Joi.string().optional().label('Modelo'),
  mesesMtto: Joi.array().items(Joi.string()).optional().label('mesesMtto'),
  Servicio: Joi.string().hex().length(24).optional().label('Servicio'),
  SedeId: Joi.string().hex().length(24).optional().label('SedeId'),
  ItemId: Joi.string().hex().length(24).optional().label('ItemId'),
}).unknown(false);
