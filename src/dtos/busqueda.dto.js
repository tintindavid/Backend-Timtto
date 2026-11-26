'use strict';
import Joi from 'joi';

/**
 * Query of GET /api/v1/busqueda/equipos (change: buscador-equipos). `tenantId` is accepted only to be DISCARDED.
 * The term needs at least 2 characters that are not separators (space - _ . /).
 */
export const busquedaEquiposQueryDto = Joi.object({
  q: Joi.string().trim().min(2).max(60).required()
    // Control characters (a NUL byte cannot be serialized into a RegExp) are rejected.
    .pattern(/^\P{Cc}*$/u)
    .custom((value, helpers) => (value.replace(/[\s_./-]+/g, '').length < 2 ? helpers.error('busqueda.short') : value))
    .messages({ 'busqueda.short': 'q debe tener al menos 2 caracteres distintos de separadores' }),
  limit: Joi.number().integer().min(1).max(20).default(8),
  tenantId: Joi.any().strip(),
}).unknown(false);
