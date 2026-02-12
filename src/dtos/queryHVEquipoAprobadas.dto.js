import Joi from 'joi';

export const queryHVEquipoAprobadasParamsDto = Joi.object({
  marca: Joi.string().required().label('Marca'),
  modelo: Joi.string().required().label('Modelo')
});

export const queryHVEquipoAprobadasQueryDto = Joi.object({
  page: Joi.number().integer().min(1).default(1).optional(),
  limit: Joi.number().integer().min(1).max(100).default(10).optional(),
  sortBy: Joi.string().default('createdAt').optional(),
  order: Joi.string().valid('asc','desc').default('desc').optional(),
  // El service ya filtra por EstadoHV='Aprobada', pero aceptamos el param si el frontend lo envía
  EstadoHV: Joi.string().optional()
});
