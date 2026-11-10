import Joi from 'joi';
import { queryRequisicionDto } from './requisicion.dto.js';

/**
 * DTOs of the reporting and exports (change: requisiciones-e5-reporteria). Strict allowlists (`unknown(false)`): the
 * tenant and the identity never come from the query, only from the token.
 */

const objectId = Joi.string().hex().length(24);
const dateOnly = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({ 'string.pattern.base': '{{#label}} debe tener formato YYYY-MM-DD' })
  // 2026-02-31 matches the format but is not a calendar date (Invalid Date would reach Mongo): 400, never 500.
  .custom((value, helpers) => (!Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value ? value : helpers.message('{{#label}} no es una fecha válida')), 'calendar date');

/** GET /tablero takes no parameters. */
export const queryTableroDto = Joi.object({}).unknown(false);

/** GET /metricas. Range semantics (defaults, maximum window) are enforced by the service (400). */
export const queryMetricasDto = Joi.object({
  desde: dateOnly.optional().label('desde'),
  hasta: dateOnly.optional().label('hasta'),
  areaId: objectId.optional(),
  tipoId: objectId.optional(),
  proveedorId: objectId.optional(),
  moneda: Joi.string().trim().uppercase().pattern(/^[A-Z]{3}$/).optional()
    .messages({ 'string.pattern.base': 'moneda debe ser un código de 3 letras (por ejemplo COP)' }),
}).unknown(false);

/** GET /export/xlsx accepts EXACTLY what the list accepts (same schema; page / limit are ignored), so the button works on every tab. */
export const queryExportListadoDto = queryRequisicionDto;

/** GET /:id/licitacion/comparativo/export */
export const queryComparativoExportDto = Joi.object({
  formato: Joi.string().valid('pdf', 'xlsx').required()
    .messages({ 'any.only': 'formato debe ser pdf o xlsx', 'any.required': 'formato es obligatorio (pdf o xlsx)' }),
}).unknown(false);
