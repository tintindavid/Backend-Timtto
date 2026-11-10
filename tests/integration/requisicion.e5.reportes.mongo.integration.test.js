/**
 * Requisiciones E5 block A on a REAL MongoDB through the REAL express app: dashboard (`GET /tablero`), metrics
 * (`GET /metricas`), permission backfill and "Mi historial" actions. SKIPPED unless MONGO_INTEGRATION_URI is set; the test
 * creates and DROPS its own database `req_e5a_<random>`.
 *
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27655 node --test tests/integration/requisicion.e5.reportes.mongo.integration.test.js
 */
import '../helpers/setRateLimitEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { signToken } from '../../src/utils/jwt.util.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';
import { backfillRequisicionesPermisosE5, E5_PERMISSIONS } from '../../scripts/2026-11-09-backfill-requisiciones-permisos-e5.js';
import { requisicionMetricasService } from '../../src/services/requisicionMetricas.service.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const API = '/api/v1/requisiciones';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
const sid = (v) => String(v?._id ?? v);
let base;
let server;
let seq = 0;

const call = async (path, token) => {
  const res = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
};

async function mkApiUser(tenantId, permissions) {
  seq += 1;
  const role = await Role.create({ tenantId, name: `r${seq}-${rnd()}`, permissions });
  const user = await User.create({ tenantId, email: `h${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), firstName: 'N', lastName: 'A', fullName: 'N A', roleId: role._id });
  return { id: user._id, token: signToken({ userId: user._id, role: user.role, roleId: role._id, tenantId }) };
}

const ev = (tipo, fecha, extra = {}) => ({ eventId: oid(), tipo, fecha, actor: { tipo: 'sistema' }, ...extra });

/** Raw insert (bypasses hooks) of a requisition with the minimum valid shape. */
async function mkReq(tenantId, creator, over = {}) {
  seq += 1;
  const now = new Date();
  const doc = {
    tenantId,
    consecutivo: `REQ-2026-${String(seq).padStart(4, '0')}-${rnd()}`,
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
    lineas: [{ lineaId: oid(), descripcion: 'x', unidad: 'und', cantidadSolicitada: 1, precioEstimado: 0, estadoLinea: 'Pendiente' }],
    timeline: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
  const r = await Requisicion.collection.insertOne(doc);
  return { ...doc, _id: r.insertedId };
}

describe('Requisiciones E5 block A on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e5a_${rnd()}`;
  const saved = {};
  let T;
  let T2;

  before(async () => {
    for (const k of ['ENFORCE_TENANT_CAPABILITIES', 'RATE_LIMIT_MAX']) saved[k] = process.env[k];
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    process.env.RATE_LIMIT_MAX = '1000000';
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Area, Customer, User, Role, Tenant, Counter]) { await m.init(); await m.syncIndexes(); }
    T = `t-${rnd()}`;
    T2 = `t-${rnd()}`;
    for (const t of [T, T2]) await Tenant.create({ tenantId: t, name: `Clinica ${t}`, status: 'active', capabilities: { usesRequisiciones: true } });
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

  describe('GET /tablero', () => {
    let u; let uReports; let nobody; let other; let seeded;

    before(async () => {
      u = await mkApiUser(T, [P.REQUISICIONES_READ, P.REQUISICIONES_APPROVE, P.REQUISICIONES_RECEIVE]);
      uReports = await mkApiUser(T, [P.REQUISICIONES_READ, P.REQUISICIONES_REPORTS]);
      nobody = await mkApiUser(T, [P.AREAS_READ]);
      other = await mkApiUser(T, [P.REQUISICIONES_READ, P.REQUISICIONES_APPROVE_PO]);
      const creator = oid();
      const lvl = (ids, estado = 'Pendiente') => ({ aprobacion: { nivelActual: 1, niveles: [{ orden: 1, aprobadorTipo: 'usuarios', estado, aprobadorIds: ids }] } });
      const now = Date.now();
      const lineaConfirmar = oid();
      seeded = {
        mine: await mkReq(T, u.id),
        porAprobar: await mkReq(T, creator, { estado: 'En_Aprobacion', ...lvl([u.id]) }),
        notMine: await mkReq(T, creator, { estado: 'En_Aprobacion', ...lvl([oid()]) }),
        porRecibir: await mkReq(T, creator, { estado: 'Aprobada' }),
        ocEmitida: await mkReq(T, creator, { estado: 'OC_Emitida', ordenCompra: { numero: 'OC-1', estado: 'Emitida', total: 10, emitidaPor: creator, aprobacion: { niveles: [] } } }),
        porConfirmar: await mkReq(T, creator, {
          estado: 'En_Recepcion',
          solicitanteId: u.id,
          lineas: [{ lineaId: lineaConfirmar, descripcion: 'x', unidad: 'und', cantidadSolicitada: 1, precioEstimado: 0, estadoLinea: 'Recibida' }],
          recepciones: [{ recepcionId: oid(), fecha: new Date(), recibidaPor: creator, items: [{ lineaId: lineaConfirmar, cantidadRecibida: 1 }] }],
        }),
        abierta: await mkReq(T, creator, { estado: 'En_Licitacion', licitacion: { fechaLimiteCotizacion: new Date(now + DAY), proveedores: [] } }),
        vencida: await mkReq(T, creator, { estado: 'En_Licitacion', licitacion: { fechaLimiteCotizacion: new Date(now - DAY), proveedores: [] } }),
        lejana: await mkReq(T, creator, { estado: 'En_Licitacion', licitacion: { fechaLimiteCotizacion: new Date(now + 10 * DAY), proveedores: [] } }),
        quieta: await mkReq(T, creator, { estado: 'En_Aprobacion', ...lvl([oid()]), timeline: [ev('ENVIADA', new Date(now - 8 * DAY))], createdAt: new Date(now - 9 * DAY) }),
        cerrada: await mkReq(T, creator, { estado: 'Cerrada', timeline: [ev('CERRADA', new Date(now - 30 * DAY))], createdAt: new Date(now - 40 * DAY) }),
        revision: await mkReq(T, creator, { estado: 'OC_Enviada', ordenCompra: { numero: 'OC-2', estado: 'Enviada', total: 5, emitidaPor: creator, entrega: { estado: 'En_Revision' } } }),
        deleted: await mkReq(T, creator, { estado: 'En_Aprobacion', isDeleted: true, ...lvl([u.id]) }),
      };
      // Another tenant with the same shapes: no counter may include it.
      const foreign = oid();
      await mkReq(T2, foreign, { estado: 'En_Aprobacion', ...lvl([u.id]) });
      await mkReq(T2, u.id, { estado: 'En_Licitacion', licitacion: { fechaLimiteCotizacion: new Date(now - DAY), proveedores: [] } });
      await mkReq(T2, foreign, { estado: 'Aprobada' });
    });

    it('requires authentication and the module', async () => {
      assert.equal((await call(`${API}/tablero`)).status, 401);
      const noModule = `t-${rnd()}`;
      await Tenant.create({ tenantId: noModule, name: 'Sin modulo', status: 'active', capabilities: { usesRequisiciones: false } });
      const x = await mkApiUser(noModule, [P.REQUISICIONES_READ]);
      assert.equal((await call(`${API}/tablero`, x.token)).status, 403);
    });

    it('rejects unknown query parameters (strict DTO)', async () => {
      assert.equal((await call(`${API}/tablero?tenantId=${T2}`, u.token)).status, 400);
    });

    it('personal counters equal the length of the matching list vistas, and carry their link', async () => {
      const r = await call(`${API}/tablero`, u.token);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const { personal, tenant } = r.body.data;
      assert.equal(tenant, undefined, 'no requisiciones:reports -> no tenant section');
      assert.deepEqual(Object.keys(personal), ['mias', 'porAprobar', 'ocPorAprobar', 'porRecibir', 'porConfirmar']);
      for (const [key, vista] of [['mias', 'mias'], ['porAprobar', 'por-aprobar'], ['ocPorAprobar', 'oc-por-aprobar'], ['porRecibir', 'por-recibir'], ['porConfirmar', 'por-confirmar']]) {
        const list = await call(`${API}?vista=${vista}&limit=100`, u.token);
        assert.equal(list.status, 200, vista);
        assert.equal(personal[key].count, list.body.data.length, `${key} vs list ${vista}: ${JSON.stringify(personal[key])}`);
        assert.equal(personal[key].count, list.body.pagination.total ?? list.body.data.length);
        assert.deepEqual(personal[key].enlace, { vista });
      }
      assert.equal(personal.mias.count, 2, 'mine + the one he requested');
      assert.equal(personal.porAprobar.count, 1);
      assert.equal(personal.porConfirmar.count, 1);
      assert.ok(personal.porRecibir.count >= 1);
      assert.equal(personal.ocPorAprobar.count, 0, 'without approve-po or an eligible level');
    });

    it('the OC inbox counts for who holds approve-po and also equals the list', async () => {
      const r = await call(`${API}/tablero`, other.token);
      const list = await call(`${API}?vista=oc-por-aprobar&limit=100`, other.token);
      assert.equal(r.body.data.personal.ocPorAprobar.count, 1);
      assert.equal(list.body.data.length, 1);
    });

    it('a user with requisiciones:reports also gets the tenant section, scoped to the tenant', async () => {
      const r = await call(`${API}/tablero`, uReports.token);
      assert.equal(r.status, 200);
      const t = r.body.data.tenant;
      assert.deepEqual(Object.keys(t), ['porAprobar', 'ocPorAprobar', 'licitacionesAbiertas', 'licitacionesPorVencer', 'licitacionesVencidas', 'porRecibir', 'porConfirmar', 'entregablesPendientes', 'sinMovimiento']);
      assert.equal(t.porAprobar.count, 3, 'porAprobar + notMine + quieta; not the soft-deleted one nor the other tenant');
      assert.deepEqual(t.porAprobar.enlace, { alcance: 'tenant', estado: 'En_Aprobacion' });
      assert.equal(t.ocPorAprobar.count, 1);
      assert.equal(t.licitacionesAbiertas.count, 3);
      assert.deepEqual(t.licitacionesAbiertas.enlace, { alcance: 'tenant', filtro: 'licitaciones-abiertas' });
      assert.equal(t.licitacionesPorVencer.count, 1, 'only the one due within 2 days');
      assert.equal(t.licitacionesVencidas.count, 1, 'other tenant overdue tender is not counted');
      assert.equal(t.porRecibir.count, 2, 'Aprobada + OC_Enviada with a pending line (the En_Recepcion one is fully received)');
      assert.equal(t.porConfirmar.count, 1);
      assert.equal(t.entregablesPendientes.count, 1);
      assert.equal(t.sinMovimiento.count, 1, 'the 8-day-old En_Aprobacion counts; Cerrada does not');
      for (const c of Object.values(t)) { assert.equal(typeof c.count, 'number'); assert.equal(c.enlace.alcance, 'tenant'); }
    });

    it('a user with neither read nor reports still gets the personal section (self-scoped)', async () => {
      const r = await call(`${API}/tablero`, nobody.token);
      assert.equal(r.status, 200);
      assert.equal(r.body.data.tenant, undefined);
      assert.equal(r.body.data.personal.mias.count, 0);
    });

    it('is not affected by a route-order clash: /tablero is not treated as an :id', async () => {
      assert.notEqual((await call(`${API}/tablero`, u.token)).status, 400);
    });
  });

  describe('GET /metricas', () => {
    let rep; let reader; let P1; let P2; let A1; let A2; let ids;

    before(async () => {
      const t = `t-${rnd()}`;
      await Tenant.create({ tenantId: t, name: 'Metricas', status: 'active', capabilities: { usesRequisiciones: true } });
      ids = { t };
      rep = await mkApiUser(t, [P.REQUISICIONES_REPORTS]);
      reader = await mkApiUser(t, [P.REQUISICIONES_READ, P.REQUISICIONES_MANAGE_ALL]);
      const mkProv = (name) => Customer.create({ tenantId: t, kind: 'provider', Razonsocial: name, Ciudad: 'B', Departamento: 'C', Nit: 900000000 + (seq += 1), Email: `${rnd()}@p.co` });
      P1 = await mkProv('Proveedor Uno');
      P2 = await mkProv('Proveedor Dos');
      A1 = await Area.create({ tenantId: t, codigo: `A1${rnd()}`, nombre: 'Area Uno' });
      A2 = await Area.create({ tenantId: t, codigo: `A2${rnd()}`, nombre: 'Area Dos' });
      const creator = oid();
      const t0 = new Date(Date.now() - 5 * DAY);
      const at = (h) => new Date(t0.getTime() + h * HOUR);
      const pa1 = oid();
      await mkReq(t, creator, {
        estado: 'OC_Enviada', areaId: A1._id, montoEstimado: 800, createdAt: t0,
        licitacion: { ganadorId: pa1, proveedores: [{ _id: pa1, proveedorId: P1._id, nombre: 'Proveedor Uno', estadoEnvio: 'Ganador' }] },
        ordenCompra: { numero: 'OC-1', estado: 'Enviada', total: 1000, moneda: 'COP', emitidaPor: creator },
        timeline: [ev('ENVIADA', t0), ev('APROBADA', at(10)), ev('PROVEEDOR_SELECCIONADO', at(12)), ev('OC_ENVIADA', at(20)), ev('DEVUELTA', at(25)), ev('DEVUELTA', at(26))],
      });
      await mkReq(t, creator, {
        estado: 'Cerrada', areaId: A2._id, montoEstimado: 0, createdAt: t0,
        licitacion: { compraDirecta: { proveedorId: P2._id, justificacion: 'x'.repeat(30) }, proveedores: [] },
        ordenCompra: { numero: 'OC-2', estado: 'Enviada', total: 50, moneda: 'USD', emitidaPor: creator },
        timeline: [ev('ENVIADA', t0), ev('APROBADA', at(20)), ev('COMPRA_DIRECTA_JUSTIFICADA', at(22)), ev('OC_ENVIADA', at(30)), ev('CERRADA', at(100))],
      });
      await mkReq(t, creator, { estado: 'Rechazada', areaId: A1._id, createdAt: t0, timeline: [ev('ENVIADA', t0), ev('RECHAZADA', at(3))] });
      await mkReq(t, creator, { estado: 'Borrador', areaId: A1._id, createdAt: t0 });
      // Outside the default range and soft-deleted: never counted.
      await mkReq(t, creator, { estado: 'Cerrada', createdAt: new Date(Date.now() - 200 * DAY), ordenCompra: { numero: 'OC-3', estado: 'Enviada', total: 99999, moneda: 'COP', emitidaPor: creator } });
      await mkReq(t, creator, { estado: 'Cerrada', isDeleted: true, createdAt: t0, ordenCompra: { numero: 'OC-4', estado: 'Enviada', total: 77777, moneda: 'COP', emitidaPor: creator } });
      // Another tenant with a huge purchase.
      await mkReq(T2, oid(), { estado: 'Cerrada', createdAt: t0, ordenCompra: { numero: 'OC-9', estado: 'Enviada', total: 5555555, moneda: 'COP', emitidaPor: creator } });
    });

    it('requires requisiciones:reports (403, even with read / manage-all)', async () => {
      assert.equal((await call(`${API}/metricas`)).status, 401);
      assert.equal((await call(`${API}/metricas`, reader.token)).status, 403);
    });

    it('validates the range (400) and the filters', async () => {
      assert.equal((await call(`${API}/metricas?desde=2026-02-01&hasta=2026-01-01`, rep.token)).status, 400);
      assert.equal((await call(`${API}/metricas?desde=2024-01-01&hasta=2026-01-01`, rep.token)).status, 400);
      assert.equal((await call(`${API}/metricas?desde=nope`, rep.token)).status, 400);
      assert.equal((await call(`${API}/metricas?tenantId=${T2}`, rep.token)).status, 400);
    });

    it('computes the whole payload for the default 90-day range of the tenant', async () => {
      const r = await call(`${API}/metricas`, rep.token);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const d = r.body.data;
      assert.match(d.rango.desde, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(d.total, 4);
      assert.deepEqual(Object.fromEntries(d.porEstado.map((e) => [e.estado, e.count])), { OC_Enviada: 1, Cerrada: 1, Rechazada: 1, Borrador: 1 });
      assert.deepEqual(d.tasaRechazo, { rechazadas: 1, enviadas: 3, tasa: 0.3333 });
      assert.deepEqual(d.ciclos.envioAprobacion, { n: 2, medianaHoras: 15, p90Horas: 19 });
      assert.deepEqual(d.ciclos.aprobacionAdjudicacion, { n: 2, medianaHoras: 2, p90Horas: 2 });
      assert.equal(d.ciclos.adjudicacionOcEnviada.n, 2);
      assert.equal(d.ciclos.adjudicacionOcEnviada.medianaHoras, 8, '(20-12) and (30-22)');
      assert.deepEqual(d.ciclos.ocEnviadaCierre, { n: 1, medianaHoras: 70, p90Horas: 70 });
      assert.deepEqual(d.valorComprado, [{ moneda: 'COP', total: 1000, ordenes: 1 }, { moneda: 'USD', total: 50, ordenes: 1 }]);
      assert.deepEqual(d.estimadoVsReal, [{ moneda: 'COP', estimado: 800, real: 1000, exceso: 200, requisiciones: 1 }]);
      assert.deepEqual(d.sinEstimar, { requisiciones: 1 });
      assert.deepEqual(d.devolucionesEntregables, { total: 2, requisiciones: 1 });
      assert.deepEqual(d.topProveedores.map((p) => [p.nombre, p.moneda, p.valor, p.ordenes]), [['Proveedor Uno', 'COP', 1000, 1], ['Proveedor Dos', 'USD', 50, 1]]);
      assert.deepEqual(d.topAreas.map((a) => [a.nombre, a.moneda, a.valor]), [['Area Uno', 'COP', 1000], ['Area Dos', 'USD', 50]]);
      assert.ok(JSON.stringify(d).indexOf('5555555') < 0, 'no data from another tenant');
    });

    it('filters by area, supplier and currency', async () => {
      const byArea = (await call(`${API}/metricas?areaId=${sid(A2._id)}`, rep.token)).body.data;
      assert.equal(byArea.total, 1);
      assert.deepEqual(byArea.valorComprado, [{ moneda: 'USD', total: 50, ordenes: 1 }]);
      const byProv = (await call(`${API}/metricas?proveedorId=${sid(P1._id)}`, rep.token)).body.data;
      assert.equal(byProv.total, 1);
      assert.equal(byProv.topProveedores[0].nombre, 'Proveedor Uno');
      const none = (await call(`${API}/metricas?moneda=EUR`, rep.token)).body.data;
      assert.equal(none.total, 0);
      assert.deepEqual(none.valorComprado, []);
      assert.deepEqual(none.ciclos.envioAprobacion, { n: 0, medianaHoras: null, p90Horas: null });
      assert.deepEqual(none.tasaRechazo, { rechazadas: 0, enviadas: 0, tasa: 0 });
    });

    it('a wide explicit range includes the older requisition', async () => {
      const desde = new Date(Date.now() - 250 * DAY).toISOString().slice(0, 10);
      const r = (await call(`${API}/metricas?desde=${desde}`, rep.token)).body.data;
      assert.equal(r.total, 5);
    });

    it('a time-out of the database is answered 503 REPORTE_LENTO', async () => {
      const orig = Requisicion.aggregate;
      Requisicion.aggregate = () => ({ option: () => Promise.reject(Object.assign(new Error('operation exceeded time limit'), { code: 50 })) });
      try {
        await assert.rejects(() => requisicionMetricasService.obtener(ids.t, {}), (e) => e.statusCode === 503 && e.code === 'REPORTE_LENTO');
      } finally { Requisicion.aggregate = orig; }
    });

    it('another tenant sees only its own numbers', async () => {
      const other = await mkApiUser(T2, [P.REQUISICIONES_REPORTS]);
      const r = (await call(`${API}/metricas`, other.token)).body.data;
      assert.deepEqual(r.valorComprado, [{ moneda: 'COP', total: 5555555, ordenes: 1 }]);
    });
  });

  describe('Mi historial: purchase order actions', () => {
    it('emiti / aprobe-oc list only requisitions where the caller authored those events', async () => {
      const a = await mkApiUser(T, [P.REQUISICIONES_READ]);
      const b = await mkApiUser(T, [P.REQUISICIONES_READ]);
      const byUser = (tipo, user) => ev(tipo, new Date(), { actor: { tipo: 'usuario', usuarioId: user.id } });
      const emitted = await mkReq(T, oid(), { estado: 'OC_Emitida', timeline: [byUser('OC_EMITIDA', a)] });
      const approvedByB = await mkReq(T, oid(), { estado: 'OC_Aprobada', timeline: [byUser('OC_EMITIDA', a), byUser('OC_APROBADA', b)] });
      const ids = async (user, accion) => (await call(`${API}?vista=mi-historial&accion=${accion}&limit=100`, user.token)).body.data.map((r) => sid(r._id));
      assert.deepEqual((await ids(a, 'emiti')).sort(), [sid(emitted._id), sid(approvedByB._id)].sort());
      assert.deepEqual(await ids(b, 'emiti'), []);
      assert.deepEqual(await ids(b, 'aprobe-oc'), [sid(approvedByB._id)]);
      assert.deepEqual(await ids(a, 'aprobe-oc'), [], 'the OC approved by someone else does not appear for the issuer');
      assert.ok((await ids(b, 'todo')).includes(sid(approvedByB._id)));
      assert.deepEqual(await ids(b, 'aprobe'), [], 'aprobe stays level approvals only');
      assert.equal((await call(`${API}?vista=mi-historial&accion=otra`, a.token)).status, 400);
    });
  });

  describe('permission backfill and index', () => {
    it('grants requisiciones:reports ONLY to system roles named admin, is idempotent and honours --dry-run', async () => {
      const t = `t-${rnd()}`;
      const mk = (over) => Role.create({ tenantId: `${t}-${rnd()}`, name: `r-${rnd()}`, permissions: [P.REQUISICIONES_READ], ...over });
      const admin = await mk({ name: 'Admin', isSystem: true });
      const adminOnly = await mk({ name: 'admin' });
      const sysOnly = await mk({ isSystem: true });
      const def = await mk({ name: 'Admin', isSystem: true, isDefault: true });
      const dry = await backfillRequisicionesPermisosE5({ dryRun: true });
      assert.ok(dry.rolesToUpdate >= 1);
      assert.equal(dry.rolesUpdated, 0);
      assert.ok(!(await Role.findById(admin._id)).permissions.includes(P.REQUISICIONES_REPORTS), 'dry run writes nothing');
      const first = await backfillRequisicionesPermisosE5();
      assert.ok(first.rolesUpdated >= 1);
      for (const perm of E5_PERMISSIONS) assert.ok((await Role.findById(admin._id)).permissions.includes(perm));
      for (const r of [adminOnly, sysOnly, def]) assert.deepEqual((await Role.findById(r._id)).permissions, [P.REQUISICIONES_READ]);
      const second = await backfillRequisicionesPermisosE5();
      assert.equal(second.rolesToUpdate, 0);
      assert.equal(second.rolesUpdated, 0);
    });

    it('an unknown flag exits with an error before touching anything', () => {
      const r = spawnSync(process.execPath, ['scripts/2026-11-09-backfill-requisiciones-permisos-e5.js', '--dryrun'], { encoding: 'utf8', env: { ...process.env, MONGO_URI: 'mongodb://127.0.0.1:1/never' } });
      assert.equal(r.status, 2);
      assert.match(r.stderr, /Opción desconocida/);
    });

    it('the {tenantId, createdAt} index exists', async () => {
      const idx = await Requisicion.collection.indexes();
      assert.ok(idx.some((i) => JSON.stringify(i.key) === JSON.stringify({ tenantId: 1, createdAt: -1 })));
    });
  });
});
