import Joi from 'joi';
import { INVENTARIO_TIPOS } from '../models/inventarioRepuesto.model.js';

// Fields of the advanced level (usesInventoryAdvanced). `stockActual` is NOT writable: it only changes through
// movements (inventario-stock).
export const INVENTARIO_ADVANCED_FIELDS = Object.freeze(['referencia', 'descripcion', 'unidad', 'precio', 'stockMinimo']);

const advancedFields = {
  referencia: Joi.string().trim().allow('').optional().label('referencia'),
  descripcion: Joi.string().trim().allow('').optional().label('descripcion'),
  stockMinimo: Joi.number().min(0).optional().label('stockMinimo'),
  unidad: Joi.string().trim().allow('').optional().label('unidad'),
  precio: Joi.number().min(0).optional().label('precio'),
};

export const createInventarioRepuestoDto = Joi.object({
  nombre: Joi.string().trim().min(1).max(200).required().label('nombre'),
  tipo: Joi.string().valid(...INVENTARIO_TIPOS).required().label('tipo'),
  activo: Joi.boolean().optional().label('activo'),
  ...advancedFields,
}).unknown(false);

export const updateInventarioRepuestoDto = Joi.object({
  nombre: Joi.string().trim().min(1).max(200).optional().label('nombre'),
  tipo: Joi.string().valid(...INVENTARIO_TIPOS).optional().label('tipo'),
  activo: Joi.boolean().optional().label('activo'),
  ...advancedFields,
}).unknown(false).min(1);

export const INVENTARIO_SORT_FIELDS = Object.freeze(['nombre', 'tipo', 'createdAt', 'referencia', 'stockActual', 'precio']);

export const queryInventarioRepuestoDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid(...INVENTARIO_SORT_FIELDS).default('nombre'),
  order: Joi.string().valid('asc', 'desc').default('asc'),
  search: Joi.string().trim().max(100).optional(),
  tipo: Joi.string().valid(...INVENTARIO_TIPOS).optional(),
  activo: Joi.boolean().truthy('true').falsy('false').optional(),
  stockBajo: Joi.boolean().truthy('true').falsy('false').optional().label('stockBajo'),
}).unknown(false);
