import Joi from 'joi';

export const createInventarioRepuestoDto = Joi.object({
  tenantId: Joi.string().optional(),
  nombre: Joi.string().trim().required().label('nombre'),
  referencia: Joi.string().trim().allow('').optional().label('referencia'),
  descripcion: Joi.string().trim().allow('').optional().label('descripcion'),
  stockActual: Joi.number().min(0).required().label('stockActual'),
  stockMinimo: Joi.number().min(0).optional().label('stockMinimo'),
  unidad: Joi.string().trim().allow('').optional().label('unidad'),
  precio: Joi.number().min(0).optional().label('precio'),
});

export const updateInventarioRepuestoDto = Joi.object({
  nombre: Joi.string().trim().optional().label('nombre'),
  referencia: Joi.string().trim().allow('').optional().label('referencia'),
  descripcion: Joi.string().trim().allow('').optional().label('descripcion'),
  stockActual: Joi.number().min(0).optional().label('stockActual'),
  stockMinimo: Joi.number().min(0).optional().label('stockMinimo'),
  unidad: Joi.string().trim().allow('').optional().label('unidad'),
  precio: Joi.number().min(0).optional().label('precio'),
});

export const queryInventarioRepuestoDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().default('createdAt'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  search: Joi.string().optional(),
  stockBajo: Joi.boolean().truthy('true').falsy('false').optional().label('stockBajo'),
});
