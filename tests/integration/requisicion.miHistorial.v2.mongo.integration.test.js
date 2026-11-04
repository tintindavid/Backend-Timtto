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
  w.tipo = await tipoRequisicionService.create(tenantId, { nombre: 'Repuesto', codigo: 'REPUESTO' });
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
const reqBody = (w, ids, extra = {}) => ({ repuestoIds: ids.map(sid), areaId: sid(w.area._id), justificacion: 'Se requiere para el servicio', ...extra });
const recForm = (items, fields = {}, files = []) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('items', JSON.stringify(items));
  for (const f of files) form.append('evidencias', new Blob([f.buffer], { type: f.type }), f.name);
  return form;
};
const keys = (o) => Object.keys(o).sort();

describe('Requisiciones Mi historial v2 (filters, self-scoped vistas, dedupe, quotes)', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_mih2_${rnd()}`;
  let savedEmit;
  const saved = {};
  let w;

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
    // creator WITHOUT requisiciones:read (the persona of the change)
    w.writer = await mkUser(w.tenantId, [P.REQUISICIONES_CREATE, P.REQUISICIONES_SEND, P.REPUESTOS_READ, P.REPUESTOS_CREATE]);
  });

  after(async () => {
    if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
    notificationService.emit = savedEmit;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  const list = (user, qs) => call('GET', `/api/v1/requisiciones?${qs}`, user.token);
  const mk = async (user, { enviar = true, over = {} } = {}) => {
    const sol = await mkSol(w, over);
    const r = await call('POST', '/api/v1/repuestos/requisicion', user.token, { json: reqBody(w, [sol._id], { enviar }) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data.requisicion;
  };
  const approveAndReceive = async (rq) => {
    const ap = await call('POST', `/api/v1/requisiciones/${rq._id}/aprobacion/aprobar`, w.jefe.token, { json: { version: rq.version } });
    assert.equal(ap.status, 200, JSON.stringify(ap.body));
    const lineaId = ap.body.data.lineas[0]._id;
    const rec = await call('POST', `/api/v1/requisiciones/${rq._id}/recepciones`, w.receiver.token, { form: recForm([{ lineaId, cantidadRecibida: 2 }]) });
    assert.equal(rec.status, 201, JSON.stringify(rec.body));
    return { lineaId, recId: rec.body.data.recepciones[0]._id };
  };
  const ids = (r) => r.body.data.map((x) => x._id);

  it('filters apply in mi-historial and combine with accion; search is an escaped literal', async () => {
    const a = await mk(w.writer); const b = await mk(w.writer);
    await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(b._id) }, { $set: { estado: 'Cancelada', titulo: 'Compra (urgente) x' } });
    const h = `vista=mi-historial&accion=cree`;
    assert.deepEqual(ids(await list(w.writer, h)).sort(), [a._id, b._id].sort());
    assert.deepEqual(ids(await list(w.writer, `${h}&estado=Cancelada`)), [b._id]);
    assert.deepEqual(ids(await list(w.writer, `${h}&search=${encodeURIComponent(a.consecutivo)}`)), [a._id]);
    assert.deepEqual(ids(await list(w.writer, `${h}&search=${encodeURIComponent('(urgente)')}`)), [b._id]);
    assert.deepEqual(ids(await list(w.writer, `${h}&search=${encodeURIComponent('.*')}`)), []);
    const r = await list(w.writer, `${h}&estado=Cancelada&limit=1`);
    assert.equal(r.body.pagination.total, 1);
    assert.deepEqual(ids(await list(w.writer, `${h}&areaId=${oid()}`)), []);
    assert.deepEqual(ids(await list(w.writer, `${h}&tipoRequisicionId=${sid(w.tipo._id)}&areaId=${sid(w.area._id)}`)).length, 2);
    assert.deepEqual(ids(await list(w.writer, `${h}&fechaDesde=2999-01-01`)), []);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(ids(await list(w.writer, `${h}&fechaDesde=${today}&fechaHasta=${today}`)).length, 2);
    assert.equal((await list(w.writer, `${h}&sortBy=consecutivo&order=asc`)).status, 200);
    assert.deepEqual(ids(await list(w.writer, 'vista=mi-historial&accion=aprobe')), []);
  });

  it('self-scoped vistas need no requisiciones:read; the other vistas and plain list stay 403', async () => {
    const mine = await mk(w.writer); const others = await mk(w.creator);
    const mias = await list(w.writer, 'vista=mias');
    assert.equal(mias.status, 200, JSON.stringify(mias.body));
    assert.ok(ids(mias).includes(mine._id) && !ids(mias).includes(others._id));
    // por-confirmar: only lines whose responsible is the caller (w.requester owns the solicitud)
    const rq = await mk(w.creator);
    const { lineaId } = await approveAndReceive(rq);
    assert.ok(lineaId);
    assert.deepEqual(ids(await list(w.requester, 'vista=por-confirmar')), [rq._id]);
    assert.deepEqual(ids(await list(w.stranger, 'vista=por-confirmar')), []);
    assert.equal((await list(w.stranger, 'vista=mi-historial')).status, 200);
    for (const qs of ['', 'vista=por-aprobar', 'vista=por-recibir', 'vista=Mias', 'vista=mias&vista=mias', 'vista[]=mias', 'vista=mias%20']) {
      assert.equal((await list(w.stranger, qs)).status, 403, qs);
    }
  });

  it('rejection is one entry; a dispute counts under confirme; many lines collapse; >5 events are capped', async () => {
    const rej = await mk(w.writer);
    const rr = await call('POST', `/api/v1/requisiciones/${rej._id}/aprobacion/rechazar`, w.jefe.token, { json: { version: rej.version, observacion: 'No procede' } });
    assert.equal(rr.status, 200, JSON.stringify(rr.body));
    const r1 = await list(w.jefe, 'vista=mi-historial&accion=rechace');
    const row = r1.body.data.find((x) => x._id === rej._id);
    assert.deepEqual(row.miActividad.map((e) => e.tipo), ['NIVEL_RECHAZADO']);
    assert.equal(row.miActividad[0].nivel, 1);

    const rq = await mk(w.creator);
    const { lineaId, recId } = await approveAndReceive(rq);
    const d = await call('POST', `/api/v1/requisiciones/${rq._id}/recepciones/${recId}/confirmar`, w.requester.token, { json: { items: [{ lineaId, resultado: 'No_Llego', observacion: 'No llego' }] } });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    const c = await list(w.requester, 'vista=mi-historial&accion=confirme');
    assert.deepEqual(c.body.data.find((x) => x._id === rq._id).miActividad.map((e) => e.tipo), ['ENTREGA_DISPUTADA']);

    const me = new mongoose.Types.ObjectId(w.creator.id);
    const base0 = Date.parse('2026-03-01T10:00:00Z');
    const evs = Array.from({ length: 8 }, (_, i) => ({ tipo: 'CREADA', fecha: new Date(base0 + i * 3600e3), actor: { tipo: 'usuario', usuarioId: me } }));
    const lineEvs = Array.from({ length: 4 }, (_, i) => ({ tipo: 'ENTREGA_CONFIRMADA', fecha: new Date(base0 + 20 * 3600e3 + i * 1000), actor: { tipo: 'usuario', usuarioId: me } }));
    await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(rq._id) }, { $push: { timeline: { $each: [...evs, ...lineEvs] } } });
    const many = await list(w.creator, 'vista=mi-historial&accion=todo');
    const act = many.body.data.find((x) => x._id === rq._id).miActividad;
    assert.equal(act.length, 5);
    assert.equal(act.filter((e) => e.tipo === 'ENTREGA_CONFIRMADA').length, 1, 'N-line confirmation is one entry');
    assert.ok(new Date(act[0].fecha) >= new Date(act[1].fecha));
  });

  it('same user id in two tenants: the other tenant never leaks into list or detail', async () => {
    const mine = await mk(w.creator);
    const doc = await Requisicion.collection.findOne({ _id: new mongoose.Types.ObjectId(mine._id) });
    const { _id, ...rest } = doc;
    const other = new mongoose.Types.ObjectId();
    await Requisicion.collection.insertOne({ ...rest, _id: other, tenantId: `other-${rnd()}`, consecutivo: `X-${rnd()}` });
    const r = await list(w.creator, 'vista=mi-historial&accion=cree&limit=100');
    assert.ok(!ids(r).includes(sid(other)));
    assert.equal((await call('GET', `/api/v1/requisiciones/${other}`, w.creator.token)).status, 404);
  });

  it('quotations stay hidden for a participant who is not the creator, in detail and history; the creator still sees them', async () => {
    const rq = await mk(w.creator);
    const proveedor = {
      _id: new mongoose.Types.ObjectId(), nombre: 'Prov SA', correoEnvio: 'secreto@prov.co', estadoEnvio: 'Enviado',
      cotizacion: { valorTotal: 987654, moneda: 'COP', observacion: 'oferta', versiones: [] },
    };
    await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(rq._id) }, { $set: { 'licitacion.proveedores': [proveedor] } });
    await approveAndReceive(rq);
    const detail = await call('GET', `/api/v1/requisiciones/${rq._id}`, w.requester.token);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const text = JSON.stringify(detail.body);
    assert.ok(!text.includes('987654') && !text.includes('secreto@prov.co'));
    assert.equal(detail.body.data.licitacion.proveedores[0].cotizacion, null);
    assert.equal(detail.body.data.licitacion.proveedores[0].tieneCotizacion, true);
    const hist = await list(w.requester, 'vista=mi-historial&accion=todo');
    const hrow = hist.body.data.find((x) => x._id === rq._id);
    if (hrow) assert.ok(!JSON.stringify(hrow).includes('987654') && !JSON.stringify(hrow).includes('secreto@prov.co'));
    const jefeHist = await list(w.jefe, 'vista=mi-historial&accion=aprobe');
    assert.ok(jefeHist.body.data.some((x) => x._id === rq._id));
    assert.ok(!JSON.stringify(jefeHist.body).includes('987654'));
    const own = await call('GET', `/api/v1/requisiciones/${rq._id}`, w.creator.token);
    assert.equal(own.body.data.licitacion.proveedores[0].cotizacion?.valorTotal, 987654);
  });
});
