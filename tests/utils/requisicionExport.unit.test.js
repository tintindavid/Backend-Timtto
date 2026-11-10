/**
 * requisiciones-e5-reporteria, task 2.6 (unit part): safe cells, file names, HTML escaping, the redacted view model and
 * the Excel builders. No database, no network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { safeCell, safeRow, safeFilenamePart, attachmentHeader } from '../../src/utils/excelSafe.util.js';
import { buildRequisicionView, canSeePricesFor } from '../../src/utils/requisicionExportView.util.js';
import { buildRequisicionHtml, buildComparativoHtml } from '../../src/services/requisicionExportPdf.service.js';
import { buildRequisicionXlsx, buildComparativoXlsx, buildListadoXlsx } from '../../src/services/requisicionExportXlsx.service.js';
import { escapeHtml } from '../../src/services/requisicionOrdenCompraPdf.service.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';

const dto = (over = {}) => ({
  _id: 'r1',
  consecutivo: 'REQ-2026-0001',
  titulo: '<img src=x onerror=alert(1)>',
  estado: 'OC_Enviada',
  prioridad: 'Alta',
  moneda: 'COP',
  montoEstimado: 8500,
  justificacion: '=HYPERLINK("http://evil.test")',
  creadaPor: { _id: 'u1', firstName: 'Ana', lastName: 'Gómez' },
  solicitanteId: { _id: 'u1', firstName: 'Ana', lastName: 'Gómez' },
  areaId: { nombre: 'Compras' },
  tipoRequisicionId: { nombre: 'Insumos' },
  createdAt: '2026-11-01T15:00:00.000Z',
  lineas: [{ lineaId: 'l1', _id: 'l1', descripcion: '+SUM(1)', cantidadSolicitada: 2, precioEstimado: 4250, unidad: 'und', estadoLinea: 'Pendiente' }],
  aprobacion: { niveles: [{ orden: 1, nombre: 'Jefe', estado: 'Aprobado', decididoPor: { firstName: 'Luis', lastName: 'P' }, fecha: '2026-11-02T10:00:00Z', observacion: '@cmd' }] },
  recepciones: [{ fecha: '2026-11-05T10:00:00Z', recibidaPor: { firstName: 'Rosa', lastName: 'Q' }, items: [{ lineaId: 'l1', cantidadRecibida: 1 }] }],
  licitacion: { ganadorId: 'pa1', proveedores: [{ _id: 'pa1', nombre: 'Proveedor SA', cotizacion: { valorTotal: 777777 } }] },
  ordenCompra: { numero: 'OC-2026-0007', estado: 'Enviada', total: 8500, moneda: 'COP', fechaEntrega: '2026-11-20T00:00:00Z', entrega: { archivos: [{ nombre: 'remision.pdf', url: 'https://files.test/secret' }] } },
  timeline: [
    { tipo: 'CREADA', fecha: '2026-11-01T15:00:00Z', actor: { tipo: 'usuario', usuarioId: { firstName: 'Ana', lastName: 'Gómez' } } },
    { tipo: 'OC_EMITIDA', fecha: '2026-11-03T15:00:00Z', actor: { tipo: 'sistema' }, datos: { total: 8500 } },
    { tipo: 'COTIZACION_RECIBIDA', fecha: '2026-11-03T16:00:00Z', actor: { tipo: 'proveedor', nombreExterno: 'Proveedor SA' } },
    { tipo: 'APROBADA', fecha: '2026-11-02T10:00:00Z', actor: { tipo: 'sistema' }, observacion: '-1+1' },
  ],
  ...over,
});

describe('safeCell / safeRow', () => {
  it('prefixes every text that could be read as a formula (= + - @ tab CR)', () => {
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx', '=HYPERLINK("http://x")']) assert.equal(safeCell(bad), `'${bad}`, bad);
  });
  it('keeps normal text, numbers, dates and booleans; null for empty and non-finite numbers', () => {
    assert.equal(safeCell('hola = mundo'), 'hola = mundo');
    assert.equal(safeCell(12.5), 12.5);
    assert.equal(safeCell(-3), -3);
    assert.equal(safeCell(NaN), null);
    assert.equal(safeCell(null), null);
    assert.equal(safeCell(undefined), null);
    assert.equal(safeCell(true), true);
    const d = new Date();
    assert.equal(safeCell(d), d);
    assert.equal(safeCell({ toString: () => '=evil' }), "'=evil");
    assert.deepEqual(safeRow(['=a', 1, null]), ["'=a", 1, null]);
  });
});

describe('file names', () => {
  it('only letters, digits, dot, dash and underscore; never empty, never hidden', () => {
    assert.equal(safeFilenamePart('REQ-2026-0001'), 'REQ-2026-0001');
    assert.equal(safeFilenamePart('..\\..\\evil"; x=1\r\nSet-Cookie: a'), '_.._evil___x_1__Set-Cookie__a'.replace(/^\.+/, ''));
    assert.equal(safeFilenamePart(''), 'requisicion');
    assert.equal(safeFilenamePart(null, 'x'), 'x');
    assert.ok(!/["\r\n;\\/]/.test(safeFilenamePart('a"b\r\nc;d/e\\f')));
    assert.equal(attachmentHeader('REQ 1', 'pdf'), 'attachment; filename="REQ_1.pdf"');
  });
});

describe('view model: built from the redacted DTO, prices behind one switch', () => {
  const user = (permissions, userId = 'u9') => ({ userId, role: 'user', permissions });
  it('canSeePricesFor: purchasing permissions or the creator', () => {
    assert.equal(canSeePricesFor(user([P.REQUISICIONES_READ]), dto()), false);
    assert.equal(canSeePricesFor(user([P.REQUISICIONES_ISSUE_PO]), dto()), true);
    assert.equal(canSeePricesFor(user([P.REQUISICIONES_READ], 'u1'), dto()), true, 'creator');
    assert.equal(canSeePricesFor(null, dto()), false);
  });
  it('without prices: no amounts, no purchase order, no deliverables, no quote or order events', () => {
    const v = buildRequisicionView(dto(), { canSeePrices: false });
    const json = JSON.stringify(v);
    assert.equal(v.totalEstimado, null);
    assert.equal(v.ordenCompra, null);
    assert.ok(v.lineas.every((l) => l.precio === null && l.subtotal === null));
    for (const leak of ['8500', '4250', '8.500', 'OC-2026-0007', 'remision', 'files.test', '777777', 'Proveedor SA', 'Orden de compra', 'Cotización']) assert.ok(!json.includes(leak), leak);
    assert.deepEqual(v.historial.map((h) => h.evento), ['Creada', 'Aprobada']);
  });
  it('with prices: amounts, the order and the deliverable NAMES (never URLs); quotes are never part of it', () => {
    const v = buildRequisicionView(dto(), { canSeePrices: true });
    const json = JSON.stringify(v);
    assert.equal(v.totalEstimado, 8500);
    assert.equal(v.lineas[0].subtotal, 8500);
    assert.equal(v.ordenCompra.numero, 'OC-2026-0007');
    assert.deepEqual(v.ordenCompra.entregables, ['remision.pdf']);
    assert.equal(v.ordenCompra.proveedor, 'Proveedor SA');
    assert.ok(!json.includes('files.test') && !json.includes('777777'));
  });
});

describe('HTML builders escape every value', () => {
  it('escapeHtml', () => assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'));
  it('the requisition sheet shows HTML / script as text and prints no URL', () => {
    const html = buildRequisicionHtml(buildRequisicionView(dto({ justificacion: 'texto' }), { canSeePrices: true, tenantNombre: '<b>Clinica</b>' }));
    assert.ok(!html.includes('<img src=x'), 'raw tag not present');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('&lt;b&gt;Clinica&lt;/b&gt;'));
    assert.ok(!/https?:\/\//.test(html.replace(/<!DOCTYPE[^>]*>/, '')), 'no URL at all (file URLs never reach the sheet)');
    assert.ok(!/<script|onerror=alert\(1\)>/.test(html.replace('onerror=alert(1)&gt;', '')));
    assert.ok(html.includes('OC-2026-0007'));
  });
  it('without prices the sheet says so and carries no amount', () => {
    const html = buildRequisicionHtml(buildRequisicionView(dto(), { canSeePrices: false }));
    assert.ok(html.includes('no se muestran por permisos'));
    assert.ok(!html.includes('OC-2026-0007') && !/8[.,]?500/.test(html) && !html.includes('Precio estimado'));
  });
  it('the comparison page escapes names and marks the cheapest', () => {
    const html = buildComparativoHtml([
      { nombre: '<script>x</script>', estadoEnvio: 'Enviado', valorTotal: 100, moneda: 'COP', tiempoEntregaDias: 3, masEconomica: true },
      { nombre: 'B', estadoEnvio: 'Enviado', valorTotal: 200, moneda: 'COP', tiempoEntregaDias: null, masEconomica: false },
    ], { consecutivo: 'REQ-1', titulo: '<i>t</i>', hayComparables: true });
    assert.ok(!html.includes('<script>x') && html.includes('&lt;script&gt;x&lt;/script&gt;'));
    assert.ok(html.includes('class="best"'));
    assert.ok(!html.includes('no son comparables'));
    assert.ok(buildComparativoHtml([], { hayComparables: false }).includes('no son comparables'));
  });
});

const load = async (buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer); return wb; };
const allCells = (wb) => {
  const out = [];
  wb.eachSheet((s) => s.eachRow((r) => r.eachCell((c) => out.push({ sheet: s.name, value: c.value, type: c.type }))));
  return out;
};

describe('Excel builders', () => {
  it('requisition workbook: five sheets, formulas neutralised, no formula cell anywhere, no URL', async () => {
    const wb = await load(await buildRequisicionXlsx(buildRequisicionView(dto(), { canSeePrices: true })));
    assert.deepEqual(wb.worksheets.map((s) => s.name), ['Resumen', 'Líneas', 'Aprobación', 'Recepciones', 'Historial']);
    const cells = allCells(wb);
    assert.ok(cells.every((c) => c.type !== ExcelJS.ValueType.Formula && !(c.value && typeof c.value === 'object' && 'formula' in c.value)));
    const texts = cells.filter((c) => typeof c.value === 'string').map((c) => c.value);
    assert.ok(texts.includes(`'=HYPERLINK("http://evil.test")`));
    assert.ok(texts.includes(`'+SUM(1)`));
    assert.ok(texts.includes(`'@cmd`));
    assert.ok(texts.includes(`'-1+1`));
    assert.ok(!texts.some((t) => /^[=+\-@]/.test(t)), 'no text cell starts with a formula character');
    assert.ok(!texts.some((t) => t.includes('files.test')));
    assert.ok(texts.includes('OC-2026-0007'));
  });
  it('requisition workbook without prices: money columns empty and no order', async () => {
    const wb = await load(await buildRequisicionXlsx(buildRequisicionView(dto(), { canSeePrices: false })));
    const lineas = wb.getWorksheet('Líneas');
    assert.equal(lineas.getRow(2).getCell(6).value, null);
    assert.equal(lineas.getRow(2).getCell(7).value, null);
    const json = JSON.stringify(allCells(wb));
    for (const leak of ['8500', '4250', 'OC-2026-0007', 'remision', '777777', 'Proveedor SA']) assert.ok(!json.includes(leak), leak);
  });
  it('comparison workbook: one row per supplier, marker and neutralised names', async () => {
    const wb = await load(await buildComparativoXlsx([
      { nombre: '=cmd', estadoEnvio: 'Enviado', fechaRespuesta: '2026-11-02T10:00:00Z', valorTotal: 100, moneda: 'COP', tiempoEntregaDias: 3, masEconomica: true },
      { nombre: 'B', estadoEnvio: 'Enviado', fechaRespuesta: null, valorTotal: 200, moneda: 'COP', tiempoEntregaDias: null, masEconomica: false },
    ], { consecutivo: 'REQ-1', titulo: 't', hayComparables: true }));
    const s = wb.getWorksheet('Comparativo');
    assert.equal(s.getRow(2).getCell(1).value, "'=cmd");
    assert.equal(s.getRow(2).getCell(7).value, 'Sí');
    assert.equal(s.getRow(3).getCell(7).value, '');
    assert.equal(s.getRow(2).getCell(4).value, 100);
  });
  it('list workbook: header + one row per requisition, safe cells', async () => {
    const wb = await load(await buildListadoXlsx([
      { consecutivo: 'REQ-1', titulo: '=2+2', estado: 'Cerrada', tipo: 'T', area: 'A', solicitante: 'Ana', createdAt: new Date('2026-11-01T15:00:00Z'), fechaRequerida: null, montoEstimado: null, montoOc: 5, moneda: 'COP' },
    ]));
    const s = wb.getWorksheet('Requisiciones');
    assert.equal(s.rowCount, 2);
    assert.equal(s.getRow(2).getCell(2).value, "'=2+2");
    assert.equal(s.getRow(2).getCell(7).value, '2026-11-01');
    assert.equal(s.getRow(2).getCell(9).value, null);
  });
});
