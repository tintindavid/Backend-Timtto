import { Requisicion } from '../models/requisicion.model.js';
import { requireTenant } from '../utils/tenant.util.js';
import { mapReportError } from '../utils/requisicionReport.util.js';
import { requisicionService } from './requisicion.service.js';
import { REPORTE_MAX_TIME_MS, REQUISICION_ESTADO } from '../constants/requisicion.constants.js';
import { FACET_PRE_MATCH, FACET_PROJECT, tenantFilterMatch } from '../utils/requisicionTenantFilters.util.js';
import { SELF_SCOPED_VISTAS } from '../middlewares/requisicionReadAccess.middleware.js';

/**
 * Dashboard of pending items (change: requisiciones-e5-reporteria, tasks 1.3).
 *  - `personal`: counted with EXACTLY the filter of the matching list vista (`requisicionService.buildListQuery`), so a
 *    number and its list can never diverge.
 *  - `tenant` (only with `requisiciones:reports`): one `$facet` aggregation, always starting with the tenant match.
 * Every counter is `{ count, enlace }`; `enlace` holds the query params of the list that shows those items, or null.
 */

const counter = (count, enlace) => ({ count: Number(count) || 0, enlace });

/** [key, list filters] of the personal counters (the keys are the contract with the frontend). */
export const PERSONAL_VISTAS = Object.freeze([
  ['mias', { vista: 'mias' }],
  ['porAprobar', { vista: 'por-aprobar' }],
  ['ocPorAprobar', { vista: 'oc-por-aprobar' }],
  ['porRecibir', { vista: 'por-recibir' }],
  ['porConfirmar', { vista: 'por-confirmar' }],
]);

/**
 * Facet branches of the tenant section: [key, $match, enlace]. Every match comes from the SHARED predicates
 * (requisicionTenantFilters.util.js), the same ones `GET /requisiciones?alcance=tenant&filtro=...` applies.
 */
const TENANT_COUNTERS = Object.freeze([
  ['porAprobar', null, { alcance: 'tenant', estado: REQUISICION_ESTADO.EN_APROBACION }],
  ['ocPorAprobar', 'oc-por-aprobar'],
  ['licitacionesAbiertas', 'licitaciones-abiertas'],
  ['licitacionesPorVencer', 'licitaciones-por-vencer'],
  ['licitacionesVencidas', 'licitaciones-vencidas'],
  ['porRecibir', 'por-recibir'],
  ['porConfirmar', 'por-confirmar'],
  ['entregablesPendientes', 'entregables-pendientes'],
  ['sinMovimiento', 'sin-movimiento'],
]);

export function tenantFacets(now = new Date()) {
  return TENANT_COUNTERS.map(([key, filtro, enlace]) => [
    key,
    filtro ? tenantFilterMatch(filtro, now) : { estado: REQUISICION_ESTADO.EN_APROBACION },
    enlace || { alcance: 'tenant', filtro },
  ]);
}

export class RequisicionTableroService {
  /**
   * @param {string} tenantId
   * @param {string} userId  identity from the token
   * @param {{ canReceive?: boolean, canManageAll?: boolean, canApprovePo?: boolean, canReports?: boolean }} access
   */
  async obtener(tenantId, userId, access = {}, now = new Date()) {
    requireTenant(tenantId);
    const personal = await this._personal(tenantId, userId, access);
    const out = { personal };
    if (access.canReports) out.tenant = await this._tenant(tenantId, now);
    return out;
  }

  async _personal(tenantId, userId, access) {
    const entries = await Promise.all(PERSONAL_VISTAS.map(async ([key, filters]) => {
      const query = await requisicionService.buildListQuery(tenantId, userId, filters, access);
      // Same expression the list uses for its total.
      let count;
      try {
        count = await Requisicion.countDocuments({ ...query, isDeleted: { $ne: true } }).maxTimeMS(REPORTE_MAX_TIME_MS);
      } catch (err) {
        throw mapReportError(err);
      }
      // Without the global read a vista that is not self-scoped would lead to a 403: no link (the number still shows).
      const linkable = access.canRead !== false || SELF_SCOPED_VISTAS.includes(filters.vista);
      return [key, counter(count, linkable ? { ...filters } : null)];
    }));
    return Object.fromEntries(entries);
  }

  async _tenant(tenantId, now) {
    const facets = tenantFacets(now);
    const facet = Object.fromEntries(facets.map(([key, match]) => [key, [{ $match: match }, { $count: 'n' }]]));
    try {
      const [res] = await Requisicion.aggregate([
        { $match: { tenantId, isDeleted: { $ne: true } } },
        { $match: FACET_PRE_MATCH },
        { $project: FACET_PROJECT },
        { $facet: facet },
      ]).option({ maxTimeMS: REPORTE_MAX_TIME_MS });
      return Object.fromEntries(facets.map(([key, , enlace]) => [key, counter(res?.[key]?.[0]?.n, enlace)]));
    } catch (err) {
      throw mapReportError(err);
    }
  }
}

export const requisicionTableroService = new RequisicionTableroService();
