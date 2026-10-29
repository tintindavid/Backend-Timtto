import Joi from 'joi';
import { REPUESTO_REQUISICION_FILTER_VALUES } from '../constants/requisicion.constants.js';

export const queryRepuestosDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().default('createdAt'),
  order: Joi.string().valid('asc','desc').default('desc'),
  search: Joi.string().empty('').optional(),
  estado: Joi.string().empty('').optional().label('estado'),
  clienteId: Joi.string().hex().length(24).empty('').optional().label('clienteId'),
  // Requisiciones module: `sin` | `con` | a disponibilidad. Ignored when the tenant does not use the module.
  requisicionEstado: Joi.string().valid(...REPUESTO_REQUISICION_FILTER_VALUES).empty('').optional().label('requisicionEstado'),
});
