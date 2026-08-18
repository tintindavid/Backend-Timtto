'use strict';
import Joi from 'joi';

export const queryUserDto = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  sortBy: Joi.string().valid('createdAt', 'updatedAt', 'firstName', 'lastName', 'email').default('createdAt'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  // Free-text search across name fields — kept for backwards compat.
  search: Joi.string().allow('').optional(),
  // Field-specific filters used by the redesigned Users page. All optional.
  name: Joi.string().allow('').optional(),
  email: Joi.string().allow('').optional(),
  role: Joi.string().valid('admin', 'technician', 'user').optional(),
  roleId: Joi.string().hex().length(24).optional().allow(''),
  // true → only users with fileFirma; false → only users WITHOUT fileFirma;
  // omitted → no filter. Used by the client-portal "crear acceso" modal to
  // populate the attribution selector (2026-08-03).
  hasFirma: Joi.boolean().optional(),
  fields: Joi.string().optional(),
  populate: Joi.string().optional(),
  // Eligibility filter (ot-responsables-programacion-trazable) — only
  // return users whose role includes this permission string, e.g.
  // `?permission=ots:can-be-responsible` feeds the OtResponsablesModal
  // multi-select.
  permission: Joi.string().optional(),
});
