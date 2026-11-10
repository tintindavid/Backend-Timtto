import PDFMicroserviceClient from './pdfMicroserviceClient.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { REQUISICION_TIMEZONE } from '../constants/requisicion.constants.js';
import { escapeHtml } from './requisicionOrdenCompraPdf.service.js';

/**
 * PDF builders of the E5 exports (change: requisiciones-e5-reporteria, tasks 2.1 / 2.2). Generated ON DEMAND, never stored.
 * Pure HTML builders: they receive the already redacted view models (requisicionExportView.util.js / the comparison rows), put
 * EVERY value through `escapeHtml`, and never load remote resources nor print URLs.
 */

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-CO', { timeZone: REQUISICION_TIMEZONE, dateStyle: 'medium' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('es-CO', { timeZone: REQUISICION_TIMEZONE, dateStyle: 'short', timeStyle: 'short' }) : '—');
const fmtQty = (q) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6 }).format(Number(q) || 0);

export function fmtMoney(value, moneda) {
  if (value === null || value === undefined) return '—';
  const n = Number(value) || 0;
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: moneda || 'COP', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${moneda || ''}`.trim();
  }
}

const e = escapeHtml;
const cell = (v) => e(v === null || v === undefined || v === '' ? '—' : v);
/** Free text: escaped first, line breaks restored afterwards. */
const text = (v) => (v ? e(v).replace(/\r?\n/g, '<br/>') : '—');

const STYLE = `
    body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 11px; margin: 0; padding: 10px; }
    h1 { font-size: 19px; margin: 0 0 2px; }
    h2 { font-size: 12px; margin: 16px 0 5px; text-transform: uppercase; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 2px; }
    .sub { color: #666; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    table.meta td { padding: 2px 6px; vertical-align: top; }
    table.meta td.k { color: #666; width: 120px; }
    table.grid th, table.grid td { border: 1px solid #ccc; padding: 4px 5px; vertical-align: top; }
    table.grid th { background: #f1f3f5; text-align: left; }
    .r { text-align: right; } .c { text-align: center; }
    .total { text-align: right; font-weight: bold; margin-top: 6px; }
    .note { color: #666; font-style: italic; margin-top: 6px; }
    .best { background: #e6f4ea; font-weight: bold; }`;

const head = (title) => `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${e(title)}</title><style>${STYLE}</style></head><body>`;

const table = (headers, rows, classes = []) => `<table class="grid"><thead><tr>${headers.map((h, i) => `<th class="${classes[i] || ''}">${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;

/** HTML of the requisition sheet from its (redacted) view model. */
export function buildRequisicionHtml(view) {
  const meta = view.resumen.map(([k, v]) => {
    const value = v instanceof Date ? fmtDate(v) : (k === 'Justificación' ? text(v) : cell(v));
    return `<tr><td class="k">${e(k)}</td><td>${value}</td></tr>`;
  }).join('');

  const prices = view.canSeePrices;
  const lineas = table(
    ['#', 'Descripción', 'Unidad', 'Cantidad', ...(prices ? ['Precio estimado', 'Subtotal'] : []), 'Estado'],
    view.lineas.map((l) => `<tr><td class="c">${e(l.n)}</td><td>${e(l.descripcion)}${l.especificaciones ? `<br/><small>${text(l.especificaciones)}</small>` : ''}</td><td>${cell(l.unidad)}</td><td class="r">${e(fmtQty(l.cantidad))}</td>${prices ? `<td class="r">${e(fmtMoney(l.precio, view.moneda))}</td><td class="r">${e(fmtMoney(l.subtotal, view.moneda))}</td>` : ''}<td>${cell(l.estado)}</td></tr>`),
    ['c', '', '', 'r', ...(prices ? ['r', 'r'] : []), ''],
  );

  const aprobacion = view.aprobacion.length
    ? table(['Nivel', 'Nombre', 'Estado', 'Decidido por', 'Fecha', 'Observación'], view.aprobacion.map((n) => `<tr><td class="c">${e(n.orden)}</td><td>${cell(n.nombre)}</td><td>${cell(n.estado)}</td><td>${cell(n.decididoPor)}</td><td>${e(fmtDate(n.fecha))}</td><td>${text(n.observacion)}</td></tr>`))
    : '<div class="note">Sin niveles de aprobación.</div>';

  const recepciones = view.recepciones.length
    ? view.recepciones.map((r) => `<div><strong>${e(fmtDate(r.fecha))}</strong> — recibida por ${cell(r.recibidaPor)}${r.documento ? ` — documento ${e(r.documento)}` : ''}${r.observacion ? `<br/>${text(r.observacion)}` : ''}${table(['Línea', 'Cantidad', 'Confirmación'], r.items.map((it) => `<tr><td>${cell(it.descripcion)}</td><td class="r">${e(fmtQty(it.cantidad))}</td><td>${it.confirmacion ? `${cell(it.confirmacion.resultado)}${it.confirmacion.por ? ` — ${e(it.confirmacion.por)}` : ''}` : 'Pendiente'}</td></tr>`), ['', 'r', ''])}</div>`).join('<br/>')
    : '<div class="note">Sin recepciones registradas.</div>';

  const oc = view.ordenCompra
    ? `<h2>Orden de compra</h2><table class="meta">
        <tr><td class="k">Número</td><td>${cell(view.ordenCompra.numero)}</td><td class="k">Estado</td><td>${cell(view.ordenCompra.estado)}</td></tr>
        <tr><td class="k">Proveedor</td><td>${cell(view.ordenCompra.proveedor)}</td><td class="k">Entrega</td><td>${e(fmtDate(view.ordenCompra.fechaEntrega))}</td></tr>
        <tr><td class="k">Total</td><td colspan="3">${e(fmtMoney(view.ordenCompra.total, view.ordenCompra.moneda))}</td></tr>
      </table>${view.ordenCompra.entregables.length ? `<div>Entregables: ${view.ordenCompra.entregables.map((n) => e(n)).join(', ')}</div>` : ''}`
    : '';

  const historial = view.historial.length
    ? table(['Fecha', 'Evento', 'Actor', 'Estado', 'Observación'], view.historial.map((h) => `<tr><td>${e(fmtDateTime(h.fecha))}</td><td>${cell(h.evento)}</td><td>${cell(h.actor)}</td><td>${cell(h.estado)}</td><td>${text(h.observacion)}</td></tr>`))
    : '<div class="note">Sin eventos.</div>';

  return `${head(`Requisición ${view.consecutivo}`)}
    <h1>Requisición ${e(view.consecutivo)}</h1>
    <div class="sub">${e(view.tenantNombre)} — generado el ${e(fmtDateTime(view.generadoEn))}</div>
    <table class="meta">${meta}</table>
    <h2>Líneas</h2>${lineas}
    ${prices ? `<div class="total">Total estimado: ${e(fmtMoney(view.totalEstimado, view.moneda))}</div>` : '<div class="note">Los importes no se muestran por permisos.</div>'}
    <h2>Aprobación</h2>${aprobacion}
    <h2>Recepciones</h2>${recepciones}
    ${oc}
    <h2>Historial</h2>${historial}
  </body></html>`;
}

/**
 * HTML of the quotation comparison. `rows` come from `requisicionLicitacionCotizacionService.comparativo` reduced to the exported
 * columns (no files, no links, no tokens): { nombre, estadoEnvio, fechaRespuesta, valorTotal, moneda, tiempoEntregaDias, masEconomica }.
 */
export function buildComparativoHtml(rows, view = {}) {
  const body = rows.map((r) => `<tr class="${r.masEconomica ? 'best' : ''}"><td>${cell(r.nombre)}</td><td>${cell(r.estadoEnvio)}</td><td>${e(fmtDate(r.fechaRespuesta))}</td><td class="r">${r.valorTotal === null || r.valorTotal === undefined ? '—' : e(fmtMoney(r.valorTotal, r.moneda))}</td><td>${cell(r.moneda)}</td><td class="r">${cell(r.tiempoEntregaDias)}</td><td class="c">${r.masEconomica ? 'Sí' : ''}</td></tr>`);
  return `${head(`Comparativo ${view.consecutivo || ''}`)}
    <h1>Comparativo de cotizaciones</h1>
    <div class="sub">${e(view.tenantNombre || '')} — ${e(view.consecutivo || '')}${view.titulo ? ` — ${e(view.titulo)}` : ''} — generado el ${e(fmtDateTime(view.generadoEn || new Date()))}</div>
    ${table(['Proveedor', 'Estado', 'Respuesta', 'Valor total', 'Moneda', 'Entrega (días)', 'Más económica'], body, ['', '', '', 'r', '', 'r', 'c'])}
    ${view.hayComparables ? '' : '<div class="note">Las cotizaciones no son comparables (monedas distintas o menos de dos cotizaciones): no se marca la más económica.</div>'}
  </body></html>`;
}

export class RequisicionExportPdfService {
  // Seam for tests (ESM bindings are immutable). The client is created on first use.
  deps = { client: null };

  _client() {
    if (!this.deps.client) this.deps.client = new PDFMicroserviceClient();
    return this.deps.client;
  }

  /** HTML -> PDF buffer; any failure of the microservice is a 502 PDF_NO_DISPONIBLE and changes nothing. */
  async render(html, logCtx = {}) {
    try {
      return await this._client().generatePDF(html);
    } catch (err) {
      logger.warn('requisicion export pdf failed', { ...logCtx, err: String(err?.message || err) });
      throw new ApiError(502, 'El servicio de PDF no está disponible; intenta de nuevo en un momento', 'PDF_NO_DISPONIBLE');
    }
  }
}

export const requisicionExportPdfService = new RequisicionExportPdfService();
