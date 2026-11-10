import ExcelJS from 'exceljs';
import { safeRow } from '../utils/excelSafe.util.js';
import { REQUISICION_TIMEZONE } from '../constants/requisicion.constants.js';

/**
 * Excel builders of the E5 exports (change: requisiciones-e5-reporteria, tasks 2.3 / 2.4 / 2.2). Built in memory from the
 * already redacted view models; EVERY text cell goes through `safeCell` (formula-injection prefix). Dates are written as text
 * in America/Bogota so the sheet reads the same everywhere. No URLs of files and no tokens are ever written.
 */

const HEADER_FILL = 'FF005B9A';
const MONEY_FMT = '#,##0.00';

export const xlsxDate = (d) => (d ? new Date(d).toLocaleDateString('sv-SE', { timeZone: REQUISICION_TIMEZONE }) : null);
export const xlsxDateTime = (d) => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: REQUISICION_TIMEZONE }) : null);

function styleHeader(sheet, row = 1) {
  const r = sheet.getRow(row);
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.alignment = { vertical: 'middle' };
  r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }; });
}

/** Sheet with a header row (static labels) and safe data rows; `widths` and `moneyCols` (1-based) are optional. */
function addSheet(wb, name, headers, rows, { widths = [], moneyCols = [] } = {}) {
  const sheet = wb.addWorksheet(name);
  sheet.addRow(headers);
  styleHeader(sheet);
  for (const row of rows) sheet.addRow(safeRow(row));
  headers.forEach((h, i) => {
    sheet.getColumn(i + 1).width = widths[i] || Math.max(14, String(h).length + 4);
    if (moneyCols.includes(i + 1)) sheet.getColumn(i + 1).numFmt = MONEY_FMT;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return sheet;
}

const newWorkbook = () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TIMTTO';
  wb.created = new Date();
  return wb;
};

const toBuffer = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());

/** Workbook of one requisition: Resumen, Líneas, Aprobación, Recepciones, Historial. */
export async function buildRequisicionXlsx(view) {
  const wb = newWorkbook();
  const resumen = view.resumen.map(([k, v]) => [k, v instanceof Date ? xlsxDateTime(v) : v]);
  resumen.push(['Generado', xlsxDateTime(view.generadoEn)]);
  if (view.canSeePrices) {
    resumen.push(['Total estimado', view.totalEstimado], ['Moneda', view.moneda]);
    if (view.ordenCompra) {
      resumen.push(
        ['Orden de compra', view.ordenCompra.numero], ['Estado de la orden', view.ordenCompra.estado],
        ['Proveedor', view.ordenCompra.proveedor], ['Total de la orden', view.ordenCompra.total], ['Moneda de la orden', view.ordenCompra.moneda],
        ['Entrega de la orden', xlsxDate(view.ordenCompra.fechaEntrega)],
        ['Entregables', view.ordenCompra.entregables.join(', ') || null],
      );
    }
  }
  const sheet = addSheet(wb, 'Resumen', ['Campo', 'Valor'], resumen, { widths: [26, 70] });
  if (view.canSeePrices) {
    for (const key of ['Total estimado', 'Total de la orden']) {
      sheet.eachRow((row) => { if (row.getCell(1).value === key) row.getCell(2).numFmt = MONEY_FMT; });
    }
  }

  addSheet(wb, 'Líneas',
    ['#', 'Descripción', 'Especificaciones', 'Unidad', 'Cantidad', 'Precio estimado', 'Subtotal', 'Estado'],
    view.lineas.map((l) => [l.n, l.descripcion, l.especificaciones, l.unidad, l.cantidad, view.canSeePrices ? l.precio : null, view.canSeePrices ? l.subtotal : null, l.estado]),
    { widths: [6, 40, 36, 10, 12, 16, 16, 18], moneyCols: view.canSeePrices ? [6, 7] : [] });

  addSheet(wb, 'Aprobación', ['Nivel', 'Nombre', 'Estado', 'Decidido por', 'Fecha', 'Observación'],
    view.aprobacion.map((n) => [n.orden, n.nombre, n.estado, n.decididoPor, xlsxDateTime(n.fecha), n.observacion]),
    { widths: [8, 28, 14, 26, 20, 50] });

  const recRows = [];
  for (const r of view.recepciones) {
    for (const it of r.items) {
      recRows.push([xlsxDateTime(r.fecha), r.recibidaPor, r.documento, it.descripcion, it.cantidad, it.confirmacion?.resultado ?? 'Pendiente', it.confirmacion?.por ?? null, r.observacion]);
    }
  }
  addSheet(wb, 'Recepciones', ['Fecha', 'Recibida por', 'Documento', 'Línea', 'Cantidad recibida', 'Confirmación', 'Confirmó', 'Observación'], recRows,
    { widths: [20, 26, 18, 36, 16, 16, 26, 40] });

  addSheet(wb, 'Historial', ['Fecha', 'Evento', 'Actor', 'Estado', 'Observación'],
    view.historial.map((h) => [xlsxDateTime(h.fecha), h.evento, h.actor, h.estado, h.observacion]),
    { widths: [20, 34, 28, 18, 60] });
  return toBuffer(wb);
}

/** Workbook of the comparison: one row per supplier (columns of the on-screen table, without files, links or tokens). */
export async function buildComparativoXlsx(rows, view = {}) {
  const wb = newWorkbook();
  const sheet = addSheet(wb, 'Comparativo',
    ['Proveedor', 'Estado', 'Fecha de respuesta', 'Valor total', 'Moneda', 'Tiempo de entrega (días)', 'Más económica'],
    rows.map((r) => [r.nombre, r.estadoEnvio, xlsxDate(r.fechaRespuesta), r.valorTotal, r.moneda, r.tiempoEntregaDias, r.masEconomica ? 'Sí' : '']),
    { widths: [36, 14, 18, 16, 10, 22, 16], moneyCols: [4] });
  sheet.addRow([]);
  sheet.addRow(safeRow(['Requisición', view.consecutivo]));
  sheet.addRow(safeRow(['Título', view.titulo]));
  if (!view.hayComparables) sheet.addRow(safeRow(['Nota', 'Las cotizaciones no son comparables (monedas distintas o menos de dos): no se marca la más económica.']));
  return toBuffer(wb);
}

/** Workbook of the list: one row per requisition (amounts blank for rows the viewer cannot price). */
export async function buildListadoXlsx(rows) {
  const wb = newWorkbook();
  addSheet(wb, 'Requisiciones',
    ['Consecutivo', 'Título', 'Estado', 'Tipo', 'Área', 'Solicitante', 'Creación', 'Fecha requerida', 'Monto estimado', 'Monto de la OC', 'Moneda'],
    rows.map((r) => [r.consecutivo, r.titulo, r.estado, r.tipo, r.area, r.solicitante, xlsxDate(r.createdAt), xlsxDate(r.fechaRequerida), r.montoEstimado, r.montoOc, r.moneda]),
    { widths: [18, 40, 18, 22, 22, 26, 14, 16, 18, 18, 10], moneyCols: [9, 10] });
  return toBuffer(wb);
}
