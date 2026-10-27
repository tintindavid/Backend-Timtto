import Joi from 'joi';
import { APROBADOR_TIPO, APROBADOR_TIPO_VALUES } from '../constants/requisicion.constants.js';

const objectId = Joi.string().hex().length(24);
const usuariosIds = Joi.array().items(objectId).min(1).max(50).unique().label('usuariosIds');

// The approver fields depend on `aprobadorTipo`: jefe_area takes none, rol needs rolId, usuarios needs usuariosIds.
export const createReglaAprobacionDto = Joi.object({
  orden: Joi.number().integer().min(1).required().label('orden'),
  nombre: Joi.string().trim().min(1).max(120).required().label('nombre'),
  montoDesde: Joi.number().min(0).required().label('montoDesde'),
  montoHasta: Joi.number().min(0).allow(null).greater(Joi.ref('montoDesde')).optional().label('montoHasta'),
  aprobadorTipo: Joi.string().valid(...APROBADOR_TIPO_VALUES).required().label('aprobadorTipo'),
  rolId: Joi.when('aprobadorTipo', { is: APROBADOR_TIPO.ROL, then: objectId.required(), otherwise: Joi.forbidden() }).label('rolId'),
  usuariosIds: Joi.when('aprobadorTipo', { is: APROBADOR_TIPO.USUARIOS, then: usuariosIds.required(), otherwise: Joi.forbidden() }),
  activo: Joi.boolean().optional().label('activo'),
}).unknown(false);

// Partial update: the service merges with the stored rule and re-validates the combination.
export const updateReglaAprobacionDto = Joi.object({
  orden: Joi.number().integer().min(1).optional().label('orden'),
  nombre: Joi.string().trim().min(1).max(120).optional().label('nombre'),
  montoDesde: Joi.number().min(0).optional().label('montoDesde'),
  montoHasta: Joi.number().min(0).allow(null).optional().label('montoHasta'),
  aprobadorTipo: Joi.string().valid(...APROBADOR_TIPO_VALUES).optional().label('aprobadorTipo'),
  rolId: objectId.allow(null).optional().label('rolId'),
  usuariosIds: Joi.array().items(objectId).max(50).unique().optional().label('usuariosIds'),
  activo: Joi.boolean().optional().label('activo'),
}).unknown(false).min(1);

export const queryReglaAprobacionDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  activo: Joi.boolean().truthy('true').falsy('false').optional(),
}).unknown(false);
