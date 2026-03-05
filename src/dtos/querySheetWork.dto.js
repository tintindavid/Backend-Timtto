import Joi from 'joi';

export const querySheetWorkDto = Joi.object({
  // Paginación
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().default('createdAt'),
  order: Joi.string().valid('asc','desc').default('desc'),
  search: Joi.string().optional(),
  
  // Filtros
  clienteId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  otId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  responsable: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  numeroHoja: Joi.string().optional(),
  PdfGenerado: Joi.boolean().optional(),
});

