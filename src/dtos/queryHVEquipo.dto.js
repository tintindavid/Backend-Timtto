import Joi from 'joi';
import { USO_EQUIPO_VALUES } from '../constants/hvEquipo.constants.js';

export const queryHVEquipoDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(200),
  sortBy: Joi.string().default('createdAt'),
  order: Joi.string().valid('asc','desc').default('desc'),
  search: Joi.string().optional(),
  EstadoHV: Joi.string().valid('Guardada', 'Aprobada').optional(),
  TipoEquipo: Joi.string().optional(),
  UsoEquipo: Joi.string().valid(...USO_EQUIPO_VALUES).optional(),
  clienteId: Joi.string().hex().length(24).optional()
});
