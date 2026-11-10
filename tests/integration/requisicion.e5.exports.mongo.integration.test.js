/**
 * Requisiciones E5 block B on a REAL MongoDB through the REAL express app: PDF / Excel of a requisition, of the tender comparison
 * and of the list. The PDF microservice is stubbed (captures the HTML). SKIPPED unless MONGO_INTEGRATION_URI is set; the test
 * creates and DROPS its own database `req_e5b_<random>`.
 *
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27655 node --test tests/integration/requisicion.e5.exports.mongo.integration.test.js
 */
import '../helpers/setRateLimitEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { signToken } from '../../src/utils/jwt.util.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';
import { requisicionExportPdfService } from '../../src/services/requisicionExportPdf.service.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const API = '/api/v1/requisiciones';
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)]);
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
const sid = (v) => String(v?._id ?? v);
let base;
let server;
let seq = 0;

const call = async (path, token) => {
  const res = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const type = res.headers.get('content-type') || '';
  const raw = Buffer.from(await res.arrayBuffer());
  let json = null;
  if (type.includes('application/json')) { try { json = JSON.parse(raw.toString('utf8')); } catch { /* no body */ } }
  return { status: res.status, headers: res.headers, raw, json, type };
};

async function mkApiUser(tenantId, permissions) {
  seq += 1;
  const role = await Role.create({ tenantId, name: `r${seq}-${rnd()}`, permissions });
  const user = await User.create({ tenantId, email: `h${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), firstName: 'Nombre', lastName: `U${seq}`, fullName: `Nombre U${seq}`, roleId: role._id });
  return { id: user._id, token: signToken({ userId: user._id, role: user.role, roleId: role._id, tenantId }) };
}

async function mkReq(tenantId, creator, over = {}) {
  seq += 1;
  const lineaId = oid();
  const now = new Date();
  const doc = {
    tenantId,
    consecutivo: over.consecutivo || `REQ-2026-${String(seq).padStart(4, '0')}`,
    titulo: `Req ${seq}`,
    tipoRequisicionId: oid(),
    areaId: oid(),
    creadaPor: creator,
    solicitanteId: creator,
    estado: 'Borrador',
    moneda: 'COP',
    montoEstimado: 0,
    version: 1,
    prioridad: 'Media',
    isDeleted: false,
    lineas: [{ lineaId, descripcion: 'x', unidad: 'und', cantidadSolicitada: 1, precioEstimado: 0, estadoLinea: 'Pendiente' }],
    timeline: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
  const r = await Requisicion.collection.insertOne(doc);
  return { ...doc, _id: r.insertedId, lineaId };
}

const loadXlsx = async (buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer); return wb; };
const cellsOf = (wb) => { const out = []; wb.eachSheet((s) => s.eachRow((r) => r.eachCell((c) => out.push(c.value)))); return out; };

describe('Requisiciones E5 block B (exports) on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e5b_${rnd()}`;
  const saved = {};
  const pdfHtml = [];
  let savedClient;
  let pdfFails = false;
  let T; let T2; let w;

  before(async () => {
    for (const k of ['ENFORCE_TENANT_CAPABILITIES', 'RATE_LIMIT_MAX']) saved[k] = process.env[k];
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    process.env.RATE_LIMIT_MAX = '1000000';
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Area, TipoRequisicion, User, Role, Tenant, Counter]) { await m.init(); await m.syncIndexes(); }
    savedClient = requisicionExportPdfService.deps.client;
    requisicionExportPdfService.deps.client = {
      generatePDF: async (html) => { pdfHtml.push(html); if (pdfFails) throw new Error('pdf down'); return PDF_BYTES; },
    };
    T = `t-${rnd()}`;
    T2 = `t-${rnd()}`;
    for (const t of [T, T2]) await Tenant.create({ tenantId: t, name: `Clinica ${t}`, status: 'active', capabilities: { usesRequisiciones: true } });
    const { default: app } = await import('../../src/app.js');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    // The world of tenant T.
    const area = await Area.create({ tenantId: T, codigo: `A${rnd()}`, nombre: 'Area <Compras>' });
    const tipo = await TipoRequisicion.create({ tenantId: T, codigo: `T${rnd()}`, nombre: 'Insumos' });
    w = {
      creator: await mkApiUser(T, [P.REQUISICIONES_READ]),
      priced: await mkApiUser(T, [P.REQUISICIONES_READ, P.REQUISICIONES_ISSUE_PO]),
      plain: await mkApiUser(T, [P.REQUISICIONES_READ]),
      outsider: await mkApiUser(T, [P.AREAS_READ]),
      buyer: await mkApiUser(T, [P.REQUISICIONES_READ, P.REQUISICIONES_MANAGE_SUPPLIERS]),
      reports: await mkApiUser(T, [P.REQUISICIONES_REPORTS]),
      reportsRead: await mkApiUser(T, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS]),
      foreign: await mkApiUser(T2, [P.REQUISICIONES_READ, P.REQUISICIONES_ISSUE_PO, P.REQUISICIONES_REPORTS, P.REQUISICIONES_MANAGE_SUPPLIERS]),
    };
    const pa1 = oid(); const pa2 = oid();
    w.req = await mkReq(T, w.creator.id, {
      consecutivo: 'REQ-2026-9001',
      titulo: '<script>alert("x")</script> Compra',
      justificacion: '=HYPERLINK("http://evil.test","clic")',
      estado: 'OC_Enviada',
      areaId: area._id,
      tipoRequisicionId: tipo._id,
      montoEstimado: 424242,
      lineas: [{ lineaId: oid(), descripcion: '=cmd|calc', unidad: 'und', cantidadSolicitada: 2, precioEstimado: 212121, estadoLinea: 'Pendiente' }],
      aprobacion: { nivelActual: 1, niveles: [{ orden: 1, nombre: 'Jefe', aprobadorTipo: 'jefe_area', estado: 'Aprobado', observacion: '@evil', aprobadorIds: [] }] },
      licitacion: {
        fechaLimiteCotizacion: new Date(Date.now() + 86400000),
        ganadorId: pa1,
        proveedores: [
          { _id: pa1, proveedorId: oid(), nombre: 'Proveedor <Uno>', estadoEnvio: 'Ganador', tokenHash: 'HASH-SECRETO', tokenHint: 'abcd', cotizacion: { valorTotal: 777001, moneda: 'COP', tiempoEntregaDias: 5, origen: 'portal', fechaRespuesta: new Date(), archivo: { url: 'https://files.test/cotizacion-secreta.pdf', nombre: 'cot.pdf' }, linkPropuesta: 'https://prop.test/x' } },
          { _id: pa2, proveedorId: oid(), nombre: 'Proveedor Dos', estadoEnvio: 'Enviado', cotizacion: { valorTotal: 888002, moneda: 'COP', tiempoEntregaDias: 9, origen: 'interno', fechaRespuesta: new Date() } },
        ],
      },
      ordenCompra: {
        numero: 'OC-2026-5555', version: 1, estado: 'Enviada', requiereEntregables: true, total: 424242, moneda: 'COP', condiciones: 'Pago a 30 dias', emitidaPor: oid(),
        lineas: [{ lineaId: oid(), descripcion: 'x', cantidad: 2, precioUnitario: 212121, subtotal: 424242 }],
        entrega: { estado: 'En_Revision', archivos: [{ url: 'https://files.test/remision-secreta.pdf', nombre: 'remision.pdf', tipo: 'application/pdf', tamano: 10, subidoPor: 'proveedor' }] },
      },
      timeline: [
        { eventId: oid(), tipo: 'CREADA', fecha: new Date(), actor: { tipo: 'usuario', usuarioId: w.creator.id } },
        { eventId: oid(), tipo: 'OC_EMITIDA', fecha: new Date(), actor: { tipo: 'usuario', usuarioId: w.priced.id }, datos: { total: 424242 } },
        { eventId: oid(), tipo: 'COTIZACION_RECIBIDA', fecha: new Date(), actor: { tipo: 'proveedor', nombreExterno: 'Proveedor <Uno>' }, datos: { valorTotal: 777001, moneda: 'COP' } },
      ],
    });
    w.url = `${API}/${sid(w.req._id)}`;
  });

  after(async () => {
    if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
    requisicionExportPdfService.deps.client = savedClient;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  const SECRETS = ['HASH-SECRETO', 'abcd', 'files.test', 'prop.test', 'cotizacion-secreta', 'remision-secreta'];
  const noSecrets = (text) => { for (const s of SECRETS) assert.ok(!text.includes(s), `leaked ${s}`); };

  describe('PDF of the requisition', () => {
    it('requires authentication; the file is named after the consecutivo', async () => {
      assert.equal((await call(`${w.url}/export/pdf`)).status, 401);
      pdfHtml.length = 0;
      const r = await call(`${w.url}/export/pdf`, w.priced.token);
      assert.equal(r.status, 200);
      assert.equal(r.type, 'application/pdf');
      assert.equal(r.headers.get('content-disposition'), 'attachment; filename="REQ-2026-9001.pdf"');
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
      assert.equal(r.raw.subarray(0, 5).toString(), '%PDF-');
    });

    it('a reader with price access gets lines, amounts, approval, history and the order; HTML is escaped; no URLs or tokens', async () => {
      pdfHtml.length = 0;
      assert.equal((await call(`${w.url}/export/pdf`, w.priced.token)).status, 200);
      const html = pdfHtml[0];
      assert.ok(html.includes('REQ-2026-9001'));
      assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Compra'));
      assert.ok(!html.includes('<script>alert'));
      assert.ok(html.includes('OC-2026-5555'));
      assert.ok(/424\.242/.test(html), 'amounts present');
      assert.ok(html.includes('remision.pdf'), 'deliverable names are fine');
      assert.ok(html.includes('Jefe') && html.includes('Orden de compra emitida'));
      noSecrets(html);
      assert.ok(!html.includes('777001') && !/777\.001/.test(html), 'quotes never go in the requisition sheet');
    });

    it('a reader WITHOUT price access gets no amounts, no purchase order and no quotations', async () => {
      pdfHtml.length = 0;
      assert.equal((await call(`${w.url}/export/pdf`, w.plain.token)).status, 200);
      const html = pdfHtml[0];
      assert.ok(html.includes('REQ-2026-9001'));
      for (const leak of ['424242', '424.242', '212.121', '212121', 'OC-2026-5555', 'remision', '777001', '777.001', '888', 'Pago a 30', 'Orden de compra', 'Proveedor']) {
        assert.ok(!html.includes(leak), `leaked ${leak}`);
      }
      noSecrets(html);
    });

    it('the creator keeps the amounts even without purchasing permissions', async () => {
      pdfHtml.length = 0;
      assert.equal((await call(`${w.url}/export/pdf`, w.creator.token)).status, 200);
      assert.ok(/424\.242/.test(pdfHtml[0]));
    });

    it('404 for a caller without read and without participation, and for another tenant; nothing is rendered', async () => {
      pdfHtml.length = 0;
      assert.equal((await call(`${w.url}/export/pdf`, w.outsider.token)).status, 404);
      assert.equal((await call(`${w.url}/export/pdf`, w.foreign.token)).status, 404);
      assert.equal((await call(`${API}/${sid(oid())}/export/pdf`, w.priced.token)).status, 404);
      assert.equal(pdfHtml.length, 0);
    });

    it('a participant without the read permission can still download (same rule as the detail)', async () => {
      const participant = await mkApiUser(T, [P.AREAS_READ]);
      const mine = await mkReq(T, participant.id, { consecutivo: 'REQ-2026-9002' });
      const r = await call(`${API}/${sid(mine._id)}/export/pdf`, participant.token);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-disposition'), 'attachment; filename="REQ-2026-9002.pdf"');
    });

    it('400 for an invalid id; 502 PDF_NO_DISPONIBLE when the microservice fails', async () => {
      assert.equal((await call(`${API}/no-es-un-id/export/pdf`, w.priced.token)).status, 400);
      pdfFails = true;
      try {
        const r = await call(`${w.url}/export/pdf`, w.priced.token);
        assert.equal(r.status, 502);
        assert.equal(r.json.error.code, 'PDF_NO_DISPONIBLE');
      } finally { pdfFails = false; }
    });

    it('403 on every export when the tenant does not have the module', async () => {
      const t3 = `t-${rnd()}`;
      await Tenant.create({ tenantId: t3, name: 'Sin modulo', status: 'active', capabilities: { usesRequisiciones: false } });
      const u = await mkApiUser(t3, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS, P.REQUISICIONES_MANAGE_SUPPLIERS]);
      for (const path of [`${w.url}/export/pdf`, `${w.url}/export/xlsx`, `${w.url}/licitacion/comparativo/export?formato=pdf`, `${API}/export/xlsx`]) {
        assert.equal((await call(path, u.token)).status, 403, path);
      }
    });
  });

  describe('Excel of the requisition', () => {
    it('five sheets, the formula text is neutralised and nothing is a formula', async () => {
      const r = await call(`${w.url}/export/xlsx`, w.priced.token);
      assert.equal(r.status, 200);
      assert.match(r.type, /spreadsheetml/);
      assert.equal(r.headers.get('content-disposition'), 'attachment; filename="REQ-2026-9001.xlsx"');
      const wb = await loadXlsx(r.raw);
      assert.deepEqual(wb.worksheets.map((s) => s.name), ['Resumen', 'Líneas', 'Aprobación', 'Recepciones', 'Historial']);
      const cells = cellsOf(wb);
      assert.ok(cells.every((v) => !(v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v))));
      assert.ok(cells.includes(`'=HYPERLINK("http://evil.test","clic")`));
      assert.ok(cells.includes(`'=cmd|calc`));
      assert.ok(cells.includes(`'@evil`));
      assert.ok(cells.includes('OC-2026-5555'));
      noSecrets(JSON.stringify(cells));
    });

    it('without price access: empty money columns, no order, no quotations', async () => {
      const r = await call(`${w.url}/export/xlsx`, w.plain.token);
      assert.equal(r.status, 200);
      const wb = await loadXlsx(r.raw);
      const lineas = wb.getWorksheet('Líneas');
      assert.equal(lineas.getRow(2).getCell(6).value, null);
      assert.equal(lineas.getRow(2).getCell(7).value, null);
      const json = JSON.stringify(cellsOf(wb));
      for (const leak of ['424242', '212121', 'OC-2026-5555', 'remision', '777001', 'Proveedor']) assert.ok(!json.includes(leak), `leaked ${leak}`);
      noSecrets(json);
    });

    it('404 without access, 404 across tenants', async () => {
      assert.equal((await call(`${w.url}/export/xlsx`, w.outsider.token)).status, 404);
      assert.equal((await call(`${w.url}/export/xlsx`, w.foreign.token)).status, 404);
    });
  });

  describe('comparison export', () => {
    const cmp = (fmt) => `${w.url}/licitacion/comparativo/export${fmt === undefined ? '' : `?formato=${fmt}`}`;

    it('manage-suppliers (or select-winner) exports PDF and Excel; others get 403', async () => {
      pdfHtml.length = 0;
      const pdf = await call(cmp('pdf'), w.buyer.token);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers.get('content-disposition'), 'attachment; filename="REQ-2026-9001-comparativo.pdf"');
      assert.ok(pdfHtml[0].includes('Proveedor &lt;Uno&gt;') && !pdfHtml[0].includes('<Uno>'));
      assert.ok(pdfHtml[0].includes('class="best"'));
      noSecrets(pdfHtml[0]);
      const x = await call(cmp('xlsx'), w.buyer.token);
      assert.equal(x.status, 200);
      const wb = await loadXlsx(x.raw);
      const s = wb.getWorksheet('Comparativo');
      assert.equal(s.getRow(2).getCell(1).value, 'Proveedor <Uno>');
      assert.equal(s.getRow(2).getCell(4).value, 777001);
      assert.equal(s.getRow(2).getCell(7).value, 'Sí', 'cheapest marked (same currency)');
      assert.equal(s.getRow(3).getCell(7).value, '');
      noSecrets(JSON.stringify(cellsOf(wb)));
      for (const u of [w.plain, w.priced, w.reports, w.outsider]) assert.equal((await call(cmp('pdf'), u.token)).status, 403);
    });

    it('invalid or missing formato -> 400; another tenant -> 404; PDF down -> 502', async () => {
      assert.equal((await call(cmp('docx'), w.buyer.token)).status, 400);
      assert.equal((await call(cmp(), w.buyer.token)).status, 400);
      assert.equal((await call(`${w.url}/licitacion/comparativo/export?formato=pdf&x=1`, w.buyer.token)).status, 400);
      assert.equal((await call(cmp('xlsx'), w.foreign.token)).status, 404);
      pdfFails = true;
      try {
        const r = await call(cmp('pdf'), w.buyer.token);
        assert.equal(r.status, 502);
        assert.equal(r.json.error.code, 'PDF_NO_DISPONIBLE');
      } finally { pdfFails = false; }
    });
  });

  describe('list export', () => {
    it('needs requisiciones:reports (403 otherwise, 401 without token) and returns an xlsx', async () => {
      assert.equal((await call(`${API}/export/xlsx`)).status, 401);
      assert.equal((await call(`${API}/export/xlsx`, w.plain.token)).status, 403);
      assert.equal((await call(`${API}/export/xlsx`, w.priced.token)).status, 403);
      const r = await call(`${API}/export/xlsx`, w.reportsRead.token);
      assert.equal(r.status, 200, r.raw.toString().slice(0, 300));
      assert.match(r.type, /spreadsheetml/);
      assert.match(r.headers.get('content-disposition'), /^attachment; filename="requisiciones-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    });

    it('applies the filters of the list, only the tenant rows, neutralised text and blank amounts without price access', async () => {
      await mkReq(T, w.creator.id, { consecutivo: 'REQ-2026-9100', titulo: '=1+1', estado: 'Cerrada', montoEstimado: 5000 });
      await mkReq(T, w.creator.id, { consecutivo: 'REQ-2026-9101', titulo: 'Abierta', estado: 'Aprobada' });
      await mkReq(T2, w.foreign.id, { consecutivo: 'REQ-2026-9199', titulo: 'Otro tenant', estado: 'Cerrada' });
      const r = await call(`${API}/export/xlsx?estado=Cerrada`, w.reportsRead.token);
      assert.equal(r.status, 200);
      const wb = await loadXlsx(r.raw);
      const s = wb.getWorksheet('Requisiciones');
      const rows = []; s.eachRow((row, n) => { if (n > 1) rows.push(row.values.slice(1)); });
      const ids = rows.map((x) => x[0]);
      assert.ok(ids.includes('REQ-2026-9100'));
      assert.ok(!ids.includes('REQ-2026-9101') && !ids.includes('REQ-2026-9199'));
      const mine = rows.find((x) => x[0] === 'REQ-2026-9100');
      assert.equal(mine[1], "'=1+1");
      assert.equal(mine[8] ?? null, null, 'reports user has no price permission -> blank amount');
      assert.equal((await call(`${API}/export/xlsx?estado=NoExiste`, w.reportsRead.token)).status, 400);
      assert.equal((await call(`${API}/export/xlsx?page=2`, w.reportsRead.token)).status, 200, 'same schema as the list: page is accepted and ignored');
    });

    it('a user with price access sees the amounts; the date filters and the search work', async () => {
      const both = await mkApiUser(T, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS, P.REQUISICIONES_ISSUE_PO]);
      const r = await call(`${API}/export/xlsx?search=9001&fechaDesde=2000-01-01&fechaHasta=2999-01-01`, both.token);
      assert.equal(r.status, 200);
      const wb = await loadXlsx(r.raw);
      const s = wb.getWorksheet('Requisiciones');
      assert.equal(s.rowCount, 2);
      assert.equal(s.getRow(2).getCell(1).value, 'REQ-2026-9001');
      assert.equal(s.getRow(2).getCell(9).value, 424242);
      assert.equal(s.getRow(2).getCell(10).value, 424242);
      assert.equal(s.getRow(2).getCell(5).value, 'Area <Compras>');
    });

    it('without the global read the export is limited to his own requisitions', async () => {
      const [a, b] = [await mkApiUser(T, [P.REQUISICIONES_REPORTS]), await mkApiUser(T, [P.REQUISICIONES_REPORTS])];
      await mkReq(T, a.id, { consecutivo: 'REQ-2026-9300' });
      await mkReq(T, b.id, { consecutivo: 'REQ-2026-9301' });
      const wb = await loadXlsx((await call(`${API}/export/xlsx`, a.token)).raw);
      const ids = []; wb.getWorksheet('Requisiciones').eachRow((row, n) => { if (n > 1) ids.push(row.getCell(1).value); });
      assert.deepEqual(ids, ['REQ-2026-9300']);
      assert.equal((await call(`${API}/export/xlsx?vista=por-recibir`, a.token)).status, 403, 'a non self-scoped vista needs read');
    });

    it('more than 5000 rows -> 413 EXPORT_DEMASIADAS_FILAS with the total, nothing generated', async () => {
      const t = `t-${rnd()}`;
      await Tenant.create({ tenantId: t, name: 'Grande', status: 'active', capabilities: { usesRequisiciones: true } });
      const u = await mkApiUser(t, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS]);
      const now = new Date();
      const proto = (i) => ({
        tenantId: t, consecutivo: `REQ-BIG-${i}`, titulo: 'x', tipoRequisicionId: oid(), areaId: oid(), creadaPor: u.id, solicitanteId: u.id,
        estado: 'Cerrada', moneda: 'COP', montoEstimado: 0, version: 1, isDeleted: false, lineas: [], timeline: [], createdAt: now, updatedAt: now,
      });
      await Requisicion.collection.insertMany(Array.from({ length: 5001 }, (_, i) => proto(i)));
      const r = await call(`${API}/export/xlsx`, u.token);
      assert.equal(r.status, 413);
      assert.equal(r.json.error.code, 'EXPORT_DEMASIADAS_FILAS');
      assert.equal(r.json.error.details.total, 5001);
      const narrowed = await call(`${API}/export/xlsx?search=REQ-BIG-1000`, u.token);
      assert.equal(narrowed.status, 200);
    });
  });
});
