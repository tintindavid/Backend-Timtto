import PDFMicroserviceClient from './pdfMicroserviceClient.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { requireTenant } from '../utils/tenant.util.js';
import { REQUISICION_TIMEZONE } from '../constants/requisicion.constants.js';
import { requisicionOrdenCompraService } from './requisicionOrdenCompra.service.js';
import { isParticipant } from './requisicionHistorial.service.js';
import { assertModule, loadRequisicion, sid } from './requisicionLicitacion.shared.js';

/**
 * PDF of the purchase order (change: requisiciones-e4-oc-recepcion, task 1.5). Generated ON DEMAND from the stored OC and
 * never stored, so an old copy can never be served. The HTML is built here with EVERY value escaped; the output holds the
 * order data only: no approval data, no estimate, no other suppliers.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-CO', { timeZone: REQUISICION_TIMEZONE, dateStyle: 'long' }) : '—');

function fmtMoney(value, moneda) {
  const n = Number(value) || 0;
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: moneda || 'COP', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${moneda || ''}`.trim();
  }
}

const fmtQty = (q) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6 }).format(Number(q) || 0);

/**
 * Pure builder. `oc` is the stored block; `view` carries { tenantNombre, consecutivo, titulo, proveedorNombre }.
 * Free text (conditions) keeps its line breaks AFTER being escaped.
 */
export function buildOrdenCompraHtml(oc, view = {}) {
  const rows = (oc.lineas || []).map((l, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td>${escapeHtml(l.descripcion)}</td>
          <td class="r">${escapeHtml(fmtQty(l.cantidad))}</td>
          <td class="r">${escapeHtml(fmtMoney(l.precioUnitario, oc.moneda))}</td>
          <td class="r">${escapeHtml(fmtMoney(l.subtotal, oc.moneda))}</td>
        </tr>`).join('');
  const condiciones = oc.condiciones ? escapeHtml(oc.condiciones).replace(/\r?\n/g, '<br/>') : '—';
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 12px; margin: 0; padding: 12px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 13px; margin: 18px 0 6px; text-transform: uppercase; color: #555; }
    .meta { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .meta td { padding: 3px 6px; vertical-align: top; }
    .meta td.k { color: #666; width: 140px; }
    table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
    table.items th, table.items td { border: 1px solid #ccc; padding: 5px 6px; }
    table.items th { background: #f1f3f5; text-align: left; }
    .r { text-align: right; } .c { text-align: center; }
    .total { text-align: right; font-size: 14px; font-weight: bold; margin-top: 8px; }
    .box { border: 1px solid #ddd; padding: 8px; min-height: 30px; }
  </style></head><body>
    <h1>Orden de compra ${escapeHtml(oc.numero)}</h1>
    <div>${escapeHtml(view.tenantNombre || '')}</div>
    <table class="meta">
      <tr><td class="k">Versión</td><td>${escapeHtml(oc.version)}</td><td class="k">Fecha de emisión</td><td>${escapeHtml(fmtDate(oc.emitidaEn))}</td></tr>
      <tr><td class="k">Proveedor</td><td>${escapeHtml(view.proveedorNombre || '—')}</td><td class="k">Fecha de entrega</td><td>${escapeHtml(fmtDate(oc.fechaEntrega))}</td></tr>
      <tr><td class="k">Requisición</td><td colspan="3">${escapeHtml(view.consecutivo || '')}${view.titulo ? ` — ${escapeHtml(view.titulo)}` : ''}</td></tr>
    </table>
    <h2>Detalle</h2>
    <table class="items">
      <thead><tr><th class="c">#</th><th>Descripción</th><th class="r">Cantidad</th><th class="r">Precio unitario</th><th class="r">Subtotal</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total">Total: ${escapeHtml(fmtMoney(oc.total, oc.moneda))}</div>
    <h2>Condiciones</h2>
    <div class="box">${condiciones}</div>
    ${oc.requiereEntregables ? '<h2>Entregables</h2><div class="box">Esta orden exige que adjuntes los soportes de entrega (remisión, factura, certificados) en el portal del proveedor.</div>' : ''}
  </body></html>`;
}

export class RequisicionOrdenCompraPdfService {
  // Seam for tests (ESM bindings are immutable). The client is created on first use.
  deps = { client: null };

  _client() {
    if (!this.deps.client) this.deps.client = new PDFMicroserviceClient();
    return this.deps.client;
  }

  /** Renders an OC block (stored or portal projection) to a PDF buffer. 502 PDF_NO_DISPONIBLE when the service fails. */
  async renderParts(oc, view, logCtx = {}) {
    if (!oc?.numero) throw new ApiError(404, 'La requisición no tiene orden de compra', 'ORDEN_COMPRA_NOT_FOUND');
    const html = buildOrdenCompraHtml(oc, view);
    try {
      const buffer = await this._client().generatePDF(html);
      return { buffer, filename: `${oc.numero}-v${oc.version}.pdf` };
    } catch (err) {
      logger.warn('requisicion OC pdf failed', { ...logCtx, err: String(err?.message || err) });
      throw new ApiError(502, 'El servicio de PDF no está disponible; intenta de nuevo en un momento', 'PDF_NO_DISPONIBLE');
    }
  }

  /** Renders the OC of an already loaded requisition (lean) to a PDF buffer. */
  async render(tenantId, doc) {
    const tenant = await Tenant.findOne({ tenantId }).select('name').lean();
    const ganador = (doc.licitacion?.proveedores || []).find((p) => sid(p._id) === sid(doc.licitacion?.ganadorId));
    return this.renderParts(doc.ordenCompra, {
      tenantNombre: tenant?.name,
      consecutivo: doc.consecutivo,
      titulo: doc.titulo,
      proveedorNombre: ganador?.nombre,
    }, { tenantId, requisicionId: sid(doc._id) });
  }

  /**
   * Internal download. `access = { userId, canRead, canSeePrices }`: a caller without read permission only gets the
   * requisitions he participated in (404 otherwise, as the detail does), and the real prices only go to who may see them.
   */
  async generar(tenantId, id, access = {}, capabilities = null) {
    requireTenant(tenantId);
    await assertModule(tenantId, capabilities);
    const doc = await loadRequisicion(tenantId, id);
    const isCreator = sid(doc.creadaPor) === sid(access.userId);
    if (access.canRead === false && !isParticipant(doc, access.userId)
      && !(await requisicionOrdenCompraService.puedeDecidir(tenantId, doc, access.userId, access.canApprovePo))) {
      throw new ApiError(404, 'Requisición no encontrada', 'REQUISICION_NOT_FOUND', { id });
    }
    if (!access.canSeePrices && !isCreator) {
      throw new ApiError(403, 'No tienes permiso para ver los precios de la orden de compra', 'FORBIDDEN');
    }
    return this.render(tenantId, doc);
  }
}

export const requisicionOrdenCompraPdfService = new RequisicionOrdenCompraPdfService();
