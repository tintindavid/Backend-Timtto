import { Requisicion } from '../models/requisicion.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { mapReportError } from '../utils/requisicionReport.util.js';
import { redactQuotesFor, hasOrdenCompraPermission } from '../utils/requisicionQuoteVisibility.util.js';
import { buildRequisicionView, canSeePricesFor } from '../utils/requisicionExportView.util.js';
import { safeFilenamePart } from '../utils/excelSafe.util.js';
import { buildMiHistorialMatch } from './requisicionHistorial.service.js';
import { SELF_SCOPED_VISTAS } from '../middlewares/requisicionReadAccess.middleware.js';
import { EXPORT_MAX_FILAS, REPORTE_MAX_TIME_MS, REQUISICION_SORT_FIELDS } from '../constants/requisicion.constants.js';
import { requisicionService } from './requisicion.service.js';
import { requisicionLicitacionCotizacionService } from './requisicionLicitacionCotizacion.service.js';
import { requisicionExportPdfService, buildRequisicionHtml, buildComparativoHtml } from './requisicionExportPdf.service.js';
import { buildRequisicionXlsx, buildComparativoXlsx, buildListadoXlsx } from './requisicionExportXlsx.service.js';
import { assertModule } from './requisicionLicitacion.shared.js';

/**
 * Exports of the requisitions (change: requisiciones-e5-reporteria, tasks 2.1 - 2.4). Orchestrates access, loading and the
 * renderers. Single-requisition files are built from the SAME DTO the detail returns (same read / participation rules, same
 * quote and purchase-order redaction) and never from the stored document; the list export projects explicit fields only.
 * Everything is generated on demand and nothing is stored. The result is `{ buffer, contentType, filename }` where the
 * filename comes ONLY from the sanitized consecutivo (or a fixed pattern).
 */

export const MIME = Object.freeze({
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

const personName = (u) => (u && typeof u === 'object' ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null : null);
const idOf = (v) => (v === null || v === undefined ? '' : String(v?._id ?? v));

export class RequisicionExportService {
  // Seam for tests.
  deps = { pdf: requisicionExportPdfService };

  async _tenantName(tenantId) {
    const t = await Tenant.findOne({ tenantId }).select('name').lean();
    return t?.name || '';
  }

  /**
   * The detail DTO for the viewer: 404 unless he can read / participated, quotes and purchase order redacted for him.
   * `actor = { user, userId, canRead, canApprovePo }` (identity from the token).
   */
  async _redactedDetail(tenantId, id, actor, capabilities) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const dto = await requisicionService.getById(tenantId, id, { userId: actor.userId, canRead: actor.canRead, canApprovePo: actor.canApprovePo });
    const redacted = redactQuotesFor(dto, actor.user);
    return { dto: redacted, canSeePrices: canSeePricesFor(actor.user, redacted) };
  }

  async _view(tenantId, id, actor, capabilities) {
    const { dto, canSeePrices } = await this._redactedDetail(tenantId, id, actor, capabilities);
    const view = buildRequisicionView(dto, { canSeePrices, tenantNombre: await this._tenantName(tenantId), generadoEn: new Date() });
    return view;
  }

  async requisicionPdf(tenantId, id, actor, capabilities) {
    const view = await this._view(tenantId, id, actor, capabilities);
    const buffer = await this.deps.pdf.render(buildRequisicionHtml(view), { tenantId, requisicionId: idOf(id) });
    return { buffer, contentType: MIME.pdf, filename: `${safeFilenamePart(view.consecutivo)}.pdf` };
  }

  async requisicionXlsx(tenantId, id, actor, capabilities) {
    const view = await this._view(tenantId, id, actor, capabilities);
    const buffer = await buildRequisicionXlsx(view);
    return { buffer, contentType: MIME.xlsx, filename: `${safeFilenamePart(view.consecutivo)}.xlsx` };
  }

  /** Comparison of the tender (permissions of purchasing are checked by the route). Columns of the on-screen table only. */
  async comparativo(tenantId, id, formato, capabilities) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    if (!['pdf', 'xlsx'].includes(formato)) throw new ApiError(400, 'El formato debe ser pdf o xlsx', 'FORMATO_INVALIDO');
    const comp = await requisicionLicitacionCotizacionService.comparativo(tenantId, id);
    const doc = await Requisicion.findOne(applyTenantFilter({ _id: id }, tenantId)).select('consecutivo titulo').lean();
    if (!doc) throw new ApiError(404, 'Requisición no encontrada', 'REQUISICION_NOT_FOUND', { id: idOf(id) });
    const rows = comp.proveedores.map((p) => ({
      nombre: p.nombre ?? null,
      estadoEnvio: p.estadoEnvio ?? null,
      fechaRespuesta: p.fechaRespuesta ?? null,
      valorTotal: p.valorTotal ?? null,
      moneda: p.moneda ?? null,
      tiempoEntregaDias: p.tiempoEntregaDias ?? null,
      masEconomica: Boolean(p.masEconomica),
    }));
    const view = { consecutivo: doc.consecutivo, titulo: doc.titulo, tenantNombre: await this._tenantName(tenantId), generadoEn: new Date(), hayComparables: comp.hayComparables };
    const name = `${safeFilenamePart(doc.consecutivo)}-comparativo`;
    if (formato === 'pdf') {
      const buffer = await this.deps.pdf.render(buildComparativoHtml(rows, view), { tenantId, requisicionId: idOf(id) });
      return { buffer, contentType: MIME.pdf, filename: `${name}.pdf` };
    }
    return { buffer: await buildComparativoXlsx(rows, view), contentType: MIME.xlsx, filename: `${name}.xlsx` };
  }

  /**
   * Excel of the list with the filters of the list. Tenant filter and user scope come from the same function the list uses; a
   * caller without the global `read` is limited to the self-scoped vistas (default: his own requisitions).
   * More than EXPORT_MAX_FILAS rows -> 413 EXPORT_DEMASIADAS_FILAS with the total, nothing is generated.
   */
  async listadoXlsx(tenantId, userId, filters = {}, access = {}, user = null, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const { sortBy = 'createdAt', order = 'desc', page: _p, limit: _l, ...rest } = filters;
    const f = { ...rest };
    // Scope: without the global read only the self-scoped vistas (default: his own requisitions) or the reports tenant scope.
    if (access.canRead === false && f.alcance !== 'tenant') {
      if (!f.vista) f.vista = 'mias';
      else if (!SELF_SCOPED_VISTAS.includes(f.vista)) throw new ApiError(403, 'Permisos insuficientes', 'FORBIDDEN');
    }
    const priced = hasOrdenCompraPermission(user);
    // The order must not reveal amounts the viewer cannot see.
    const sortSafe = !priced && sortBy === 'montoEstimado' ? 'createdAt' : sortBy;
    const miHistorial = f.vista === 'mi-historial';
    const query = miHistorial
      ? (buildMiHistorialMatch(tenantId, userId, f.accion, f) || { _id: null })
      : await requisicionService.buildListQuery(tenantId, userId, f, access);
    const filter = { ...query, isDeleted: { $ne: true } };
    let rows;
    try {
      const sortField = miHistorial ? 'createdAt' : (REQUISICION_SORT_FIELDS.includes(sortSafe) ? sortSafe : 'createdAt');
      const dir = order === 'asc' ? 1 : -1;
      // ONE query with a limit of MAX + 1: a concurrent insert can never silently truncate the file.
      rows = await Requisicion.find(filter)
        .select('consecutivo titulo estado tipoRequisicionId areaId solicitanteId creadaPor createdAt fechaRequerida montoEstimado moneda ordenCompra.numero ordenCompra.total ordenCompra.moneda')
        .populate({ path: 'tipoRequisicionId', select: 'nombre', model: 'TipoRequisicion' })
        .populate({ path: 'areaId', select: 'nombre', model: 'Area' })
        .populate({ path: 'solicitanteId', select: 'firstName lastName', model: 'User', options: { includeDeleted: true } })
        .sort({ [sortField]: dir, _id: dir })
        .limit(EXPORT_MAX_FILAS + 1)
        .maxTimeMS(REPORTE_MAX_TIME_MS)
        .lean();
      if (rows.length > EXPORT_MAX_FILAS) {
        const total = await Requisicion.countDocuments(filter).maxTimeMS(REPORTE_MAX_TIME_MS);
        throw new ApiError(413, `El listado tiene ${total} requisiciones; el máximo para exportar es ${EXPORT_MAX_FILAS}. Acota los filtros.`, 'EXPORT_DEMASIADAS_FILAS', { total: Math.max(total, rows.length), max: EXPORT_MAX_FILAS });
      }
    } catch (err) {
      throw mapReportError(err);
    }
    const out = rows.map((r) => {
      const seePrices = priced || (Boolean(userId) && idOf(r.creadaPor) === String(userId));
      const oc = r.ordenCompra?.numero ? r.ordenCompra : null;
      return {
        consecutivo: r.consecutivo,
        titulo: r.titulo,
        estado: r.estado,
        tipo: r.tipoRequisicionId?.nombre ?? null,
        area: r.areaId?.nombre ?? null,
        solicitante: personName(r.solicitanteId),
        createdAt: r.createdAt,
        fechaRequerida: r.fechaRequerida,
        montoEstimado: seePrices ? Number(r.montoEstimado) || 0 : null,
        montoOc: seePrices && oc ? Number(oc.total) || 0 : null,
        moneda: seePrices ? (oc?.moneda || r.moneda || null) : null,
      };
    });
    logger.info('requisiciones list export', { tenantId, userId: String(userId), rows: out.length });
    const buffer = await buildListadoXlsx(out);
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
    return { buffer, contentType: MIME.xlsx, filename: `requisiciones-${day}.xlsx` };
  }
}

export const requisicionExportService = new RequisicionExportService();
