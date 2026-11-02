/**
 * Requisiciones E2 HTTP contract against a REAL MongoDB (node:test), task 7.1 part B.
 * Starts the REAL express app (src/app.js) in-process on an ephemeral port, signs JWTs with the app's own token util
 * and exercises the HTTP surface the frontend uses, asserting the exact JSON shapes (see
 * TimttoFrontend/src/types/requisicion.types.ts and repuesto.types.ts).
 * SKIPPED unless MONGO_INTEGRATION_URI is set; the test creates and DROPS its own database `req_e2http_<random>`.
 * Firebase is stubbed through the existing `firebaseStorageService.storageDeps` seam (no network); notifications are stubbed.
 *
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27744 node --test tests/integration/requisicion.e2.http.mongo.integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { Area } from '../../src/models/area.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { areaService } from '../../src/services/area.service.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { reglaAprobacionService } from '../../src/services/reglaAprobacion.service.js';
import { signToken } from '../../src/utils/jwt.util.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
const sid = (v) => String(v);
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ALL = { usesRequisiciones: true, usesInventoryBasic: true, usesInventoryAdvanced: true };

let base;
let server;
const call = async (method, path, token, { json, form } = {}) => {
  const headers = { Authorization: `Bearer ${token}` };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`${base}${path}`, { method, headers, body });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: parsed };
};

let seq = 0;
async function mkUser(tenantId, permissions, extra = {}) {
  seq += 1;
  const role = await Role.create({ tenantId, name: `r${seq}-${rnd()}`, permissions });
  const user = await User.create({ tenantId, email: `h${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), firstName: `Nom${seq}`, lastName: `Ape${seq}`, fullName: `Nom${seq} Ape${seq}`, roleId: role._id, ...extra });
  const token = signToken({ userId: user._id, role: user.role, roleId: role._id, tenantId });
  return { user, token, id: sid(user._id) };
}

async function mkWorld() {
  const tenantId = `mh-${rnd()}`;
  await Tenant.collection.insertOne({ tenantId, name: 'T', status: 'active', capabilities: ALL, isDeleted: false });
  const w = { tenantId, cliente: oid() };
  // Everybody except the creator and the admin lacks requisiciones:read on purpose (access by participation).
  w.creator = await mkUser(tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_CREATE, P.REQUISICIONES_SEND, P.REPUESTOS_READ, P.REPUESTOS_CREATE]);
  w.jefe = await mkUser(tenantId, [P.REQUISICIONES_APPROVE]);
  w.receiver = await mkUser(tenantId, [P.REQUISICIONES_RECEIVE]);
  w.requester = await mkUser(tenantId, [P.REPUESTOS_READ]);
  w.stranger = await mkUser(tenantId, [P.REPUESTOS_READ]);
  w.tipo = await tipoRequisicionService.create(tenantId, { nombre: 'Repuesto', codigo: 'rep' });
  w.area = await areaService.create(tenantId, { nombre: 'Biomedica', codigo: 'bio', jefesIds: [w.jefe.id] });
  await reglaAprobacionService.create(tenantId, { orden: 1, nombre: 'Jefe', montoDesde: 0, montoHasta: null, aprobadorTipo: 'jefe_area' });
  return w;
}

let solSeq = 0;
const mkSol = (w, over = {}) => {
  solSeq += 1;
  return Repuestos.create({
    tenantId: w.tenantId, nombre: `Sensor ${solSeq}`, Cantidad: '2', EquipoId: oid(), OrdenId: oid(), ClienteId: w.cliente,
    ReporteSolicitudId: oid(), ResponsableSolicitud: w.requester.user._id, EstadoSolicitud: 'Solicitado', CantidadInstalacion: 2, ...over,
  });
};
const reqBody = (w, ids, extra = {}) => ({ repuestoIds: ids.map(sid), tipoRequisicionId: sid(w.tipo._id), areaId: sid(w.area._id), justificacion: 'Se requiere para el servicio', ...extra });
const recForm = (items, fields = {}, files = []) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('items', JSON.stringify(items));
  for (const f of files) form.append('evidencias', new Blob([f.buffer], { type: f.type }), f.name);
  return form;
};
const keys = (o) => Object.keys(o).sort();

describe('Requisiciones Mi historial on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_mih_${rnd()}`;
  let savedEmit;
  const saved = {};
  let w; let id;

  before(async () => {
    for (const k of ['ENFORCE_TENANT_CAPABILITIES', 'RATE_LIMIT_MAX']) saved[k] = process.env[k];
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    process.env.RATE_LIMIT_MAX = '1000000';
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Repuestos, User, Role, Tenant, InventarioRepuesto, Area, TipoRequisicion, ReglaAprobacion, Counter]) { await m.init(); await m.syncIndexes(); }
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    const { default: app } = await import('../../src/app.js');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    w = await mkWorld();
    const a = await mkSol(w);
    const created = await call('POST', '/api/v1/repuestos/requisicion', w.creator.token, { json: reqBody(w, [a._id], { enviar: true }) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    id = created.body.data.requisicion._id;
    const ap = await call('POST', `/api/v1/requisiciones/${id}/aprobacion/aprobar`, w.jefe.token, { json: { version: created.body.data.requisicion.version } });
    assert.equal(ap.status, 200, JSON.stringify(ap.body));
    const lineaId = ap.body.data.lineas[0]._id;
    const rec = await call('POST', `/api/v1/requisiciones/${id}/recepciones`, w.receiver.token, { form: recForm([{ lineaId, cantidadRecibida: 2 }]) });
    assert.equal(rec.status, 201, JSON.stringify(rec.body));
    const conf = await call('POST', `/api/v1/requisiciones/${id}/recepciones/${rec.body.data.recepciones[0]._id}/confirmar`, w.requester.token, { json: { items: [{ lineaId, resultado: 'Recibido' }] } });
    assert.equal(conf.status, 200, JSON.stringify(conf.body));
    assert.equal(conf.body.data.estado, 'Cerrada');
  });

  after(async () => {
    if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
    notificationService.emit = savedEmit;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  const hist = (user, qs = '') => call('GET', `/api/v1/requisiciones?vista=mi-historial${qs}`, user.token);
  const rowsOf = (r) => r.body.data;

  it('each actor sees the closed requisition with the matching own action (without requisiciones:read)', async () => {
    const cases = [
      [w.creator, 'cree', 'CREADA'], [w.jefe, 'aprobe', 'NIVEL_APROBADO'],
      [w.receiver, 'recibi', 'RECEPCION_REGISTRADA'], [w.requester, 'confirme', 'ENTREGA_CONFIRMADA'],
    ];
    for (const [u, accion, tipo] of cases) {
      const r = await hist(u, `&accion=${accion}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(rowsOf(r).length, 1, accion);
      const row = rowsOf(r)[0];
      assert.equal(row._id, id);
      assert.equal('timeline' in row, false);
      assert.equal(row.miActividad.length, 1);
      assert.equal(row.miActividad[0].tipo, tipo);
      assert.ok(row.miActividad[0].fecha);
      assert.equal(r.body.pagination.total, 1);
    }
    const nivel = rowsOf(await hist(w.jefe, '&accion=aprobe'))[0].miActividad[0];
    assert.equal(nivel.nivel, 1);
    assert.equal(nivel.estadoNuevo, 'En_Aprobacion');
    assert.equal(rowsOf(await hist(w.jefe, '&accion=rechace')).length, 0);
    assert.equal(rowsOf(await hist(w.receiver, '&accion=aprobe')).length, 0);
    const todo = rowsOf(await hist(w.creator, '&accion=todo'))[0];
    assert.deepEqual(todo.miActividad.map((e) => e.tipo), ['CREADA']);
  });

  it('a stranger sees nothing; plain list without read stays 403; invalid accion is 400', async () => {
    const r = await hist(w.stranger);
    assert.equal(r.status, 200);
    assert.deepEqual(rowsOf(r), []);
    assert.equal(r.body.pagination.total, 0);
    assert.equal((await call('GET', '/api/v1/requisiciones', w.jefe.token)).status, 403);
    assert.equal((await call('GET', '/api/v1/requisiciones?vista=por-aprobar', w.requester.token)).status, 403);
    const bad = await hist(w.creator, '&accion=borrar');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
  });

  it('detail by participation: participants 200, strangers 404, other tenant 404', async () => {
    for (const u of [w.jefe, w.receiver, w.requester]) {
      const r = await call('GET', `/api/v1/requisiciones/${id}`, u.token);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data._id, id);
    }
    const no = await call('GET', `/api/v1/requisiciones/${id}`, w.stranger.token);
    assert.equal(no.status, 404);
    assert.equal(no.body.error.code, 'REQUISICION_NOT_FOUND');
    const w2 = await mkWorld();
    assert.equal((await call('GET', `/api/v1/requisiciones/${id}`, w2.creator.token)).status, 404);
    assert.deepEqual(rowsOf(await hist(w2.creator)), []);
  });

  it('orders by last own action, paginates, ignores system events, and the index exists and is usable', async () => {
    const second = await mkSol(w);
    const c = await call('POST', '/api/v1/repuestos/requisicion', w.creator.token, { json: reqBody(w, [second._id]) });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const id2 = c.body.data.requisicion._id;
    let r = await hist(w.creator, '&accion=cree');
    assert.deepEqual(rowsOf(r).map((x) => x._id), [id2, id], 'newest own action first');
    r = await hist(w.creator, '&accion=cree&limit=1&page=2');
    assert.deepEqual(rowsOf(r).map((x) => x._id), [id]);
    assert.equal(r.body.pagination.total, 2);
    const jefeOid = new mongoose.Types.ObjectId(w.jefe.id);
    await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(id2) }, { $push: { timeline: { $each: [
      { tipo: 'PROVEEDOR_SELECCIONADO', fecha: new Date(), actor: { tipo: 'sistema', usuarioId: jefeOid } },
    ] } } });
    assert.equal(rowsOf(await hist(w.jefe, '&accion=adjudique')).length, 0, 'non-user actor does not count');
    await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(id2) }, { $push: { timeline: { tipo: 'PROVEEDOR_SELECCIONADO', fecha: new Date(), actor: { tipo: 'usuario', usuarioId: jefeOid } } } });
    const adj = rowsOf(await hist(w.jefe, '&accion=adjudique'));
    assert.equal(adj.length, 1);
    assert.equal(adj[0]._id, id2);
    const idx = await Requisicion.collection.indexes();
    assert.ok(idx.some((i) => i.key['timeline.actor.usuarioId'] === 1 && i.key.tenantId === 1 && i.key.createdAt === -1));
    const plan = await Requisicion.collection.find({ tenantId: w.tenantId, 'timeline.actor.usuarioId': jefeOid }).explain('queryPlanner');
    assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /IXSCAN/);
  });
});
