/**
 * Requisiciones E5 fix round on a REAL MongoDB (REAL express app): tenant counters vs the tenant-wide list, boundaries,
 * Bogota day limits, percentiles, per-currency ranking, export edge cases, rate limit. SKIPPED unless MONGO_INTEGRATION_URI.
 *
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27655 node --test tests/integration/requisicion.e5.fixes.mongo.integration.test.js
 */
import '../helpers/setRateLimitEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { signToken } from '../../src/utils/jwt.util.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';
import { tenantFilterMatch, FILTROS_TENANT } from '../../src/utils/requisicionTenantFilters.util.js';
import { requisicionTableroService } from '../../src/services/requisicionTablero.service.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const API = '/api/v1/requisiciones';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
let base;
let server;
let seq = 0;

const call = async (path, token) => {
  const res = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const type = res.headers.get('content-type') || '';
  const raw = Buffer.from(await res.arrayBuffer());
  let json = null;
  if (type.includes('application/json')) { try { json = JSON.parse(raw.toString('utf8')); } catch { /* none */ } }
  return { status: res.status, json, raw };
};

async function mkApiUser(tenantId, permissions) {
  seq += 1;
  const role = await Role.create({ tenantId, name: `r${seq}-${rnd()}`, permissions });
  const user = await User.create({ tenantId, email: `f${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), firstName: 'N', lastName: 'A', fullName: 'N A', roleId: role._id });
  return { id: user._id, token: signToken({ userId: user._id, role: user.role, roleId: role._id, tenantId }) };
}

const ev = (tipo, fecha, extra = {}) => ({ eventId: oid(), tipo, fecha, actor: { tipo: 'sistema' }, ...extra });

async function mkReq(tenantId, creator, over = {}) {
  seq += 1;
  const now = new Date();
  const doc = {
    tenantId, consecutivo: `REQ-F-${String(seq).padStart(5, '0')}-${rnd()}`, titulo: `Req ${seq}`, tipoRequisicionId: oid(), areaId: oid(),
    creadaPor: creator, solicitanteId: creator, estado: 'Borrador', moneda: 'COP', montoEstimado: 0, version: 1, prioridad: 'Media', isDeleted: false,
    lineas: [{ lineaId: oid(), descripcion: 'x', unidad: 'und', cantidadSolicitada: 1, precioEstimado: 0, estadoLinea: 'Pendiente' }],
    timeline: [], createdAt: now, updatedAt: now, ...over,
  };
  const r = await Requisicion.collection.insertOne(doc);
  return { ...doc, _id: r.insertedId };
}

const newTenant = async () => {
  const t = `t-${rnd()}`;
  await Tenant.create({ tenantId: t, name: `T ${t}`, status: 'active', capabilities: { usesRequisiciones: true } });
  return t;
};
const ids = (r) => r.json.data.map((x) => x.consecutivo).sort();

describe('Requisiciones E5 fix round on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e5f_${rnd()}`;
  const saved = {};

  before(async () => {
    for (const k of ['ENFORCE_TENANT_CAPABILITIES', 'RATE_LIMIT_MAX', 'REPORTES_RATE_LIMIT_MAX']) saved[k] = process.env[k];
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    process.env.RATE_LIMIT_MAX = '1000000';
    process.env.REPORTES_RATE_LIMIT_MAX = '100000';
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Area, Customer, User, Role, Tenant, Counter]) { await m.init(); await m.syncIndexes(); }
    const { default: app } = await import('../../src/app.js');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  describe('tenant counters == tenant-wide list (reports user WITHOUT read)', () => {
    const NOW = new Date('2026-06-15T12:00:00.000Z');
    let t; let rep; let withRead; let seeded;

    before(async () => {
      t = await newTenant();
      rep = await mkApiUser(t, [P.REQUISICIONES_REPORTS]);
      withRead = await mkApiUser(t, [P.REQUISICIONES_READ]);
      const c = oid();
      const lic = (d) => ({ licitacion: { fechaLimiteCotizacion: d, proveedores: [] } });
      const lvl = { aprobacion: { nivelActual: 1, niveles: [{ orden: 1, aprobadorTipo: 'usuarios', estado: 'Pendiente', aprobadorIds: [oid()] }] } };
      seeded = {
        limNow: await mkReq(t, c, { estado: 'En_Licitacion', ...lic(NOW) }),
        lim2d: await mkReq(t, c, { estado: 'En_Licitacion', ...lic(new Date(NOW.getTime() + 2 * DAY)) }),
        lim2dPlus: await mkReq(t, c, { estado: 'En_Licitacion', ...lic(new Date(NOW.getTime() + 2 * DAY + 1000)) }),
        limPast: await mkReq(t, c, { estado: 'En_Licitacion', ...lic(new Date(NOW.getTime() - 1000)) }),
        limNone: await mkReq(t, c, { estado: 'En_Licitacion', licitacion: { proveedores: [] } }),
        mov7: await mkReq(t, c, { estado: 'En_Aprobacion', ...lvl, timeline: [ev('ENVIADA', new Date(NOW.getTime() - 7 * DAY))] }),
        mov7Plus: await mkReq(t, c, { estado: 'En_Aprobacion', ...lvl, timeline: [ev('ENVIADA', new Date(NOW.getTime() - 7 * DAY - 1000))] }),
        recent: await mkReq(t, c, { estado: 'En_Aprobacion', ...lvl, timeline: [ev('ENVIADA', new Date(NOW.getTime() - DAY))] }),
        draftOld: await mkReq(t, c, { estado: 'Borrador', createdAt: new Date(NOW.getTime() - 30 * DAY) }),
        rejectedOld: await mkReq(t, c, { estado: 'Rechazada', createdAt: new Date(NOW.getTime() - 30 * DAY) }),
        closedOld: await mkReq(t, c, { estado: 'Cerrada', createdAt: new Date(NOW.getTime() - 30 * DAY) }),
        oc: await mkReq(t, c, { estado: 'OC_Emitida' }),
        ocRe: await mkReq(t, c, { estado: 'OC_En_Reaprobacion' }),
        recibir: await mkReq(t, c, { estado: 'Aprobada' }),
        entr: await mkReq(t, c, { estado: 'OC_Enviada', ordenCompra: { numero: 'OC-1', estado: 'Enviada', total: 1, entrega: { estado: 'Devolucion' } } }),
        conf: await mkReq(t, c, {
          estado: 'En_Recepcion',
          recepciones: [{ recepcionId: oid(), fecha: NOW, recibidaPor: c, items: [{ lineaId: oid(), cantidadRecibida: 1 }] }],
        }),
      };
    });

    it('the shared predicates count the boundaries exactly (deadline now / +2d / +2d+1s, 7 days, no deadline, inactive states)', async () => {
      const n = (f) => Requisicion.countDocuments({ tenantId: t, ...tenantFilterMatch(f, NOW) });
      assert.equal(await n('licitaciones-abiertas'), 5);
      assert.equal(await n('licitaciones-por-vencer'), 2, 'now and now+2d are inside; +2d+1s and the past are not');
      assert.equal(await n('licitaciones-vencidas'), 1, 'deadline exactly now is not overdue; no deadline is neither');
      assert.equal(await n('sin-movimiento'), 1, 'strictly older than 7 days: not exactly 7; drafts, rejected and closed never count');
      const c = await requisicionTableroService.obtener(t, String(rep.id), { canReports: true }, NOW);
      assert.equal(c.tenant.sinMovimiento.count, 1);
    });

    it('every tenant counter equals the length of its list for a reports-only user without read', async () => {
      const r = await call(`${API}/tablero`, rep.token);
      assert.equal(r.status, 200);
      const tenant = r.json.data.tenant;
      for (const [key, c] of Object.entries(tenant)) {
        assert.equal(c.enlace.alcance, 'tenant', key);
        const qs = new URLSearchParams({ ...c.enlace, limit: '100' }).toString();
        const list = await call(`${API}?${qs}`, rep.token);
        assert.equal(list.status, 200, `${key}: ${qs}`);
        assert.equal(list.json.data.length, c.count, `${key} counter vs list`);
        assert.equal(list.json.pagination.total, c.count, key);
      }
      assert.deepEqual(r.json.data.tenant.porAprobar.enlace, { alcance: 'tenant', estado: 'En_Aprobacion' });
      assert.deepEqual(r.json.data.tenant.sinMovimiento.enlace, { alcance: 'tenant', filtro: 'sin-movimiento' });
      assert.equal(tenant.ocPorAprobar.count, 2);
    });

    it('alcance=tenant needs requisiciones:reports (403 with only read), filtro needs alcance, vista excludes alcance (400)', async () => {
      assert.equal((await call(`${API}?alcance=tenant`, withRead.token)).status, 403);
      assert.equal((await call(`${API}?alcance=tenant&filtro=sin-movimiento`, withRead.token)).status, 403);
      assert.equal((await call(`${API}?filtro=sin-movimiento`, withRead.token)).status, 400);
      assert.equal((await call(`${API}?alcance=tenant&vista=mias`, rep.token)).status, 400);
      assert.equal((await call(`${API}?alcance=todas`, withRead.token)).status, 400);
      assert.equal((await call(`${API}?alcance=tenant&filtro=nope`, rep.token)).status, 400);
      assert.equal((await call(`${API}?alcance=tenant&filtro=por-recibir&estado=Aprobada`, rep.token)).json.data.length, 1, 'estado is AND-ed');
      assert.equal(FILTROS_TENANT.length, 8);
    });

    it('personal counters without the global read: no link where the list would be a 403', async () => {
      const r = (await call(`${API}/tablero`, rep.token)).json.data.personal;
      assert.equal(r.porAprobar.enlace, null);
      assert.equal(r.porRecibir.enlace, null);
      assert.deepEqual(r.mias.enlace, { vista: 'mias' });
      assert.deepEqual(r.ocPorAprobar.enlace, { vista: 'oc-por-aprobar' });
      const withLinks = (await call(`${API}/tablero`, withRead.token)).json.data.personal;
      assert.deepEqual(withLinks.porAprobar.enlace, { vista: 'por-aprobar' });
    });

    it('the tenant section never includes another tenant', async () => {
      const other = await newTenant();
      await mkReq(other, oid(), { estado: 'En_Licitacion', licitacion: { fechaLimiteCotizacion: new Date(NOW.getTime() - DAY), proveedores: [] } });
      const c = await requisicionTableroService.obtener(t, String(rep.id), { canReports: true }, NOW);
      assert.equal(c.tenant.licitacionesVencidas.count, 1);
    });
  });

  describe('export edge cases', () => {
    it('the Mi historial tab can be exported (same schema as the list)', async () => {
      const t = await newTenant();
      const u = await mkApiUser(t, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS]);
      const mine = await mkReq(t, oid(), { estado: 'OC_Emitida', timeline: [ev('OC_EMITIDA', new Date(), { actor: { tipo: 'usuario', usuarioId: u.id } })] });
      await mkReq(t, oid(), { estado: 'OC_Emitida', timeline: [ev('OC_EMITIDA', new Date(), { actor: { tipo: 'usuario', usuarioId: oid() } })] });
      const r = await call(`${API}/export/xlsx?vista=mi-historial&accion=emiti&page=1&limit=10`, u.token);
      assert.equal(r.status, 200, r.raw.toString().slice(0, 200));
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.raw);
      const out = []; wb.getWorksheet('Requisiciones').eachRow((row, n) => { if (n > 1) out.push(row.getCell(1).value); });
      assert.deepEqual(out, [mine.consecutivo]);
    });

    it('impossible calendar dates are a 400 in the list, the export and the metrics', async () => {
      const t = await newTenant();
      const u = await mkApiUser(t, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS]);
      for (const path of [`${API}?fechaDesde=2026-02-31`, `${API}/export/xlsx?fechaHasta=2026-13-01`, `${API}/metricas?desde=2026-02-31`, `${API}/metricas?hasta=2026-04-31`]) {
        assert.equal((await call(path, u.token)).status, 400, path);
      }
    });

    it('sortBy=montoEstimado is ignored for readers without price access, and their currency column is blank', async () => {
      const t = await newTenant();
      const plain = await mkApiUser(t, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS]);
      const priced = await mkApiUser(t, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS, P.REQUISICIONES_ISSUE_PO]);
      const c = oid();
      const base0 = Date.now() - 10 * DAY;
      await mkReq(t, c, { consecutivo: 'REQ-S-1', montoEstimado: 900, createdAt: new Date(base0) });
      await mkReq(t, c, { consecutivo: 'REQ-S-2', montoEstimado: 100, createdAt: new Date(base0 + DAY) });
      await mkReq(t, c, { consecutivo: 'REQ-S-3', montoEstimado: 500, createdAt: new Date(base0 + 2 * DAY) });
      const order = async (u, qs) => {
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await call(`${API}/export/xlsx?${qs}`, u.token)).raw);
        const rows = []; wb.getWorksheet('Requisiciones').eachRow((row, n) => { if (n > 1) rows.push([row.getCell(1).value, row.getCell(9).value, row.getCell(11).value]); });
        return rows;
      };
      const p1 = await order(plain, 'sortBy=montoEstimado&order=asc');
      assert.deepEqual(p1.map((x) => x[0]), ['REQ-S-1', 'REQ-S-2', 'REQ-S-3'], 'fallback to createdAt asc, not montoEstimado asc');
      assert.ok(p1.every((x) => x[1] === null && x[2] === null), 'amounts and currency blank');
      const p2 = await order(priced, 'sortBy=montoEstimado&order=asc');
      assert.deepEqual(p2.map((x) => x[0]), ['REQ-S-2', 'REQ-S-3', 'REQ-S-1']);
      assert.equal(p2[0][2], 'COP');
    });

    it('exactly 5000 rows is exported, 5001 is a 413 with the total', async () => {
      const t = await newTenant();
      const u = await mkApiUser(t, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS]);
      const now = new Date();
      const proto = (i) => ({
        tenantId: t, consecutivo: `REQ-B-${i}`, titulo: 'x', tipoRequisicionId: oid(), areaId: oid(), creadaPor: u.id, solicitanteId: u.id,
        estado: 'Cerrada', moneda: 'COP', montoEstimado: 0, version: 1, isDeleted: false, lineas: [], timeline: [], createdAt: now, updatedAt: now,
      });
      await Requisicion.collection.insertMany(Array.from({ length: 5000 }, (_, i) => proto(i)));
      const ok = await call(`${API}/export/xlsx`, u.token);
      assert.equal(ok.status, 200);
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(ok.raw);
      assert.equal(wb.getWorksheet('Requisiciones').rowCount, 5001, 'header + 5000');
      await Requisicion.collection.insertOne(proto(5000));
      const big = await call(`${API}/export/xlsx`, u.token);
      assert.equal(big.status, 413);
      assert.equal(big.json.error.code, 'EXPORT_DEMASIADAS_FILAS');
      assert.equal(big.json.error.details.total, 5001);
    });

    it('the reporting routes are rate limited per user (429 with Retry-After)', async () => {
      const t = await newTenant();
      const u = await mkApiUser(t, [P.REQUISICIONES_REPORTS]);
      const other = await mkApiUser(t, [P.REQUISICIONES_REPORTS]);
      process.env.REPORTES_RATE_LIMIT_MAX = '3';
      try {
        const codes = [];
        for (let i = 0; i < 5; i += 1) codes.push((await call(`${API}/metricas`, u.token)).status);
        assert.deepEqual(codes, [200, 200, 200, 429, 429]);
        assert.equal((await call(`${API}/tablero`, u.token)).status, 429, 'shared bucket across the reporting routes');
        assert.equal((await call(`${API}/metricas`, other.token)).status, 200, 'another user has his own bucket');
      } finally { process.env.REPORTES_RATE_LIMIT_MAX = '100000'; }
    });
  });

  describe('metrics', () => {
    it('the range follows the Bogota day: 05:00Z starts it, 04:59:59.999Z of the next day ends it', async () => {
      const t = await newTenant();
      const u = await mkApiUser(t, [P.REQUISICIONES_REPORTS]);
      const c = oid();
      const at = (iso) => new Date(iso);
      await mkReq(t, c, { createdAt: at('2026-03-10T04:59:59.999Z') });
      const a = await mkReq(t, c, { createdAt: at('2026-03-10T05:00:00.000Z') });
      const b = await mkReq(t, c, { createdAt: at('2026-03-11T04:59:59.999Z') });
      await mkReq(t, c, { createdAt: at('2026-03-11T05:00:00.000Z') });
      const r = await call(`${API}/metricas?desde=2026-03-10&hasta=2026-03-10`, u.token);
      assert.equal(r.status, 200);
      assert.equal(r.json.data.total, 2);
      assert.deepEqual(r.json.data.rango, { desde: '2026-03-10', hasta: '2026-03-10' });
      void a; void b;
    });

    it('median and P90 with five samples (10, 20, 30, 40, 100 hours)', async () => {
      const t = await newTenant();
      const u = await mkApiUser(t, [P.REQUISICIONES_REPORTS]);
      const t0 = new Date(Date.now() - 3 * DAY);
      for (const h of [10, 20, 30, 40, 100]) {
        await mkReq(t, oid(), { createdAt: t0, estado: 'Aprobada', timeline: [ev('ENVIADA', t0), ev('APROBADA', new Date(t0.getTime() + h * HOUR))] });
      }
      const d = (await call(`${API}/metricas`, u.token)).json.data;
      assert.deepEqual(d.ciclos.envioAprobacion, { n: 5, medianaHoras: 30, p90Horas: 76 });
    });

    it('top suppliers and areas are ranked PER currency, deterministic on ties', async () => {
      const t = await newTenant();
      const u = await mkApiUser(t, [P.REQUISICIONES_REPORTS]);
      const mkProv = (name) => Customer.create({ tenantId: t, kind: 'provider', Razonsocial: name, Ciudad: 'B', Departamento: 'C', Nit: 800000000 + (seq += 1), Email: `${rnd()}@p.co` });
      const sale = async (prov, total, moneda, area) => {
        const pa = oid();
        return mkReq(t, oid(), {
          estado: 'OC_Enviada', areaId: area || oid(),
          licitacion: { ganadorId: pa, proveedores: [{ _id: pa, proveedorId: prov._id, nombre: prov.Razonsocial, estadoEnvio: 'Ganador' }] },
          ordenCompra: { numero: `OC-${rnd()}`, estado: 'Enviada', total, moneda, emitidaPor: oid() },
        });
      };
      const cop = [];
      for (let i = 0; i < 12; i += 1) cop.push(await mkProv(`COP Prov ${String(i).padStart(2, '0')}`));
      for (let i = 0; i < 12; i += 1) await sale(cop[i], 1000000 + (i === 0 || i === 1 ? 0 : i), 'COP');
      const usd = await mkProv('USD Prov');
      await sale(usd, 50, 'USD');
      const d = (await call(`${API}/metricas`, u.token)).json.data;
      const copRows = d.topProveedores.filter((p) => p.moneda === 'COP');
      const usdRows = d.topProveedores.filter((p) => p.moneda === 'USD');
      assert.equal(copRows.length, 10, 'ten per currency');
      assert.equal(usdRows.length, 1, 'USD is not starved by COP');
      assert.deepEqual(copRows.map((p) => p.valor), [...copRows.map((p) => p.valor)].sort((x, y) => y - x));
      assert.equal(d.topAreas.filter((a) => a.moneda === 'USD').length, 1);
      assert.equal(d.topAreas.filter((a) => a.moneda === 'COP').length, 10);
      // Tie: COP Prov 00 and 01 share 1.000.000; the cut and the order are stable (name asc) across calls.
      const again = (await call(`${API}/metricas`, u.token)).json.data;
      assert.deepEqual(again.topProveedores, d.topProveedores);
      const tie = d.topProveedores.filter((p) => p.valor === 1000000).map((p) => p.nombre);
      assert.deepEqual(tie, [...tie].sort());
    });
  });
});
