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

async function mkWorld(caps = ALL) {
  const tenantId = `h-${rnd()}`;
  await Tenant.collection.insertOne({ tenantId, name: 'T', status: 'active', capabilities: caps, isDeleted: false });
  const w = { tenantId, cliente: oid() };
  w.creator = await mkUser(tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_CREATE, P.REQUISICIONES_SEND, P.REPUESTOS_READ, P.REPUESTOS_CREATE, P.REPUESTOS_UPDATE, P.REPUESTOS_DELETE]);
  w.jefe = await mkUser(tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_APPROVE]);
  w.receiver = await mkUser(tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_RECEIVE]);
  w.requester = await mkUser(tenantId, [P.REQUISICIONES_READ, P.REPUESTOS_READ]);
  w.noperm = await mkUser(tenantId, [P.REQUISICIONES_READ]);
  w.admin = await mkUser(tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_MANAGE_ALL, P.REPUESTOS_READ, P.REPUESTOS_CREATE]);
  w.tech = await mkUser(tenantId, ['ots:can-be-responsible']);
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

describe('Requisiciones E2 HTTP contract on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e2http_${rnd()}`;
  let savedEmit;
  let savedDeps;
  const saved = {};
  const uploads = [];

  before(async () => {
    for (const k of ['ENFORCE_TENANT_CAPABILITIES', 'RATE_LIMIT_MAX']) saved[k] = process.env[k];
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    process.env.RATE_LIMIT_MAX = '1000000';
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Repuestos, User, Role, Tenant, InventarioRepuesto, Area, TipoRequisicion, ReglaAprobacion, Counter]) { await m.init(); await m.syncIndexes(); }
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    savedDeps = firebaseStorageService.storageDeps;
    firebaseStorageService.storageDeps = {
      getFirebaseStorage: () => ({}),
      ref: (_s, path) => ({ path }),
      uploadBytes: async (r, buf, meta) => { uploads.push({ path: r.path, size: buf.length, contentType: meta.contentType }); return {}; },
      getDownloadURL: async (r) => `https://stub.invalid/${r.path}`,
      deleteObject: async () => {},
    };
    const { default: app } = await import('../../src/app.js');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
    firebaseStorageService.storageDeps = savedDeps;
    notificationService.emit = savedEmit;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  describe('the flow the frontend drives', () => {
    it('create from solicitudes -> approve -> detail shape -> receptions (multipart, with and without evidence) -> views -> confirm', async () => {
      const w = await mkWorld();
      const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Cable', unidad: 'und', precio: 5, stockActual: 9 });
      const a = await mkSol(w, { nombre: 'Cable ECG', InventarioItemId: item._id });
      const b = await mkSol(w, { nombre: 'Electrodo', Cantidad: 'un par' });

      // POST /repuestos/requisicion
      const created = await call('POST', '/api/v1/repuestos/requisicion', w.creator.token, { json: reqBody(w, [a._id, b._id], { enviar: true }) });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.success, true);
      assert.deepEqual(keys(created.body.data), ['advertencias', 'requisicion']);
      assert.ok(Array.isArray(created.body.data.advertencias));
      assert.equal(created.body.data.advertencias.length, 1);
      assert.deepEqual(keys(created.body.data.advertencias[0]).filter((k) => ['campo', 'repuestoId'].includes(k)), ['campo', 'repuestoId']);
      const rq = created.body.data.requisicion;
      assert.equal(typeof rq._id, 'string');
      assert.equal(rq.estado, 'En_Aprobacion');
      assert.equal(rq.lineas.length, 2);
      assert.equal(typeof rq.lineas[0]._id, 'string', 'lineas[]._id mirrors lineaId in write responses too');
      const id = rq._id;

      // GET /repuestos (+ requisicionEstado filter) with the summary
      const list = await call('GET', '/api/v1/repuestos?limit=50', w.creator.token);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      const rows = list.body.data.data || list.body.data;
      const rowA = rows.find((r) => r._id === sid(a._id));
      assert.deepEqual(keys(rowA.requisicion), ['cantidadConfirmada', 'consecutivo', 'disponibilidad', 'lineaId', 'requisicionId']);
      assert.equal(rowA.requisicion.requisicionId, id);
      assert.equal(rowA.requisicion.disponibilidad, 'En_Aprobacion');
      assert.equal('stockDescontadoPor' in rowA, false);
      const filtered = await call('GET', '/api/v1/repuestos?requisicionEstado=En_Aprobacion&limit=50', w.creator.token);
      assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
      assert.equal((filtered.body.data.data || filtered.body.data).length, 2);
      const none = await call('GET', '/api/v1/repuestos?requisicionEstado=sin&limit=50', w.creator.token);
      assert.equal((none.body.data.data || none.body.data).length, 0);

      // approve (frontend: POST /aprobacion/aprobar {version})
      const approved = await call('POST', `/api/v1/requisiciones/${id}/aprobacion/aprobar`, w.jefe.token, { json: { version: rq.version } });
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.data.estado, 'Aprobada');

      // GET /requisiciones/:id
      const det = await call('GET', `/api/v1/requisiciones/${id}`, w.creator.token);
      assert.equal(det.status, 200);
      const d = det.body.data;
      assert.equal(d.estado, 'Aprobada');
      const [l0, l1] = d.lineas;
      assert.equal(typeof l0._id, 'string');
      assert.equal(l0._id, l0.lineaId);
      assert.equal(l0.cantidadSolicitada, 2);
      assert.equal(l0.inventarioItemId, sid(item._id), 'bare id (frontend: string | null)');
      assert.deepEqual(keys(l0.origenSolicitudRepuestoId), ['ResponsableSolicitud', '_id', 'nombre']);
      assert.deepEqual(keys(l0.origenSolicitudRepuestoId.ResponsableSolicitud), ['_id', 'firstName', 'lastName']);
      assert.equal(l0.origenSolicitudRepuestoId.ResponsableSolicitud._id, w.requester.id);
      assert.equal(l1.cantidadSolicitada, 1);
      assert.equal(typeof d.version, 'number');
      assert.deepEqual(d.recepciones, []);

      // reception #1: multipart WITHOUT files (items as JSON string)
      const r1 = await call('POST', `/api/v1/requisiciones/${id}/recepciones`, w.receiver.token, {
        form: recForm([{ lineaId: l0._id, cantidadRecibida: 1 }], { fecha: new Date().toISOString(), documento: 'REM-9', observacion: 'Primera parte' }),
      });
      assert.equal(r1.status, 201, JSON.stringify(r1.body));
      assert.equal(r1.body.data.estado, 'En_Recepcion');
      assert.equal(r1.body.data.lineas[0].estadoLinea, 'Recibida_Parcial');
      const rec1 = r1.body.data.recepciones[0];
      assert.equal(typeof rec1._id, 'string');
      assert.equal(rec1.documento, 'REM-9');
      assert.deepEqual(rec1.evidencias, []);
      assert.deepEqual(keys(rec1.recibidaPor), ['_id', 'firstName', 'lastName']);
      assert.deepEqual(keys(rec1.items[0]).filter((k) => k !== 'confirmacion'), ['cantidadRecibida', 'lineaId']);
      assert.equal(rec1.items[0].lineaId, l0._id);

      // reception #2: with ONE small PNG evidence (Firebase stubbed through its storageDeps seam)
      const r2 = await call('POST', `/api/v1/requisiciones/${id}/recepciones`, w.receiver.token, {
        form: recForm([{ lineaId: l0._id, cantidadRecibida: 1 }, { lineaId: l1._id, cantidadRecibida: 1 }], { documento: 'REM-10' }, [{ buffer: PNG, type: 'image/png', name: 'remision.png' }]),
      });
      assert.equal(r2.status, 201, JSON.stringify(r2.body));
      const rec2 = r2.body.data.recepciones[1];
      assert.equal(rec2.evidencias.length, 1);
      assert.deepEqual(keys(rec2.evidencias[0]), ['nombre', 'tipo', 'url']);
      assert.equal(rec2.evidencias[0].tipo, 'image/png');
      assert.match(rec2.evidencias[0].url, /^https:\/\/stub\.invalid\/tenants\//);
      assert.equal(uploads.at(-1).contentType, 'image/png');

      // views
      const porRecibir = await call('GET', '/api/v1/requisiciones?vista=por-recibir', w.receiver.token);
      assert.equal(porRecibir.status, 200, JSON.stringify(porRecibir.body));
      const porConfirmar = await call('GET', '/api/v1/requisiciones?vista=por-confirmar', w.requester.token);
      assert.equal(porConfirmar.status, 200, JSON.stringify(porConfirmar.body));
      const ids = (r) => (r.body.data.data || r.body.data).map((x) => x._id);
      assert.deepEqual(ids(porConfirmar), [id]);
      assert.deepEqual(ids(await call('GET', '/api/v1/requisiciones?vista=por-confirmar', w.noperm.token)), []);

      // confirm: the receiver is refused (separation), the responsible succeeds
      const conf = (recId, items, token) => call('POST', `/api/v1/requisiciones/${id}/recepciones/${recId}/confirmar`, token, { json: { items } });
      const sep = await conf(rec1._id, [{ lineaId: l0._id, resultado: 'Recibido' }], w.receiver.token);
      assert.equal(sep.status, 403);
      assert.equal(sep.body.error.code, 'SEPARACION_FUNCIONES');
      const c1 = await conf(rec1._id, [{ lineaId: l0._id, resultado: 'Recibido' }], w.requester.token);
      assert.equal(c1.status, 200, JSON.stringify(c1.body));
      const c1rec = c1.body.data.recepciones[0].items[0].confirmacion;
      assert.equal(c1rec.resultado, 'Recibido');
      assert.deepEqual(keys(c1rec.por), ['_id', 'firstName', 'lastName']);
      const again = await conf(rec1._id, [{ lineaId: l0._id, resultado: 'No_Llego', observacion: 'x' }], w.requester.token);
      assert.equal(again.status, 409);
      assert.equal(again.body.error.code, 'ENTREGA_YA_CONFIRMADA');
      const c2 = await conf(rec2._id, [{ lineaId: l0._id, resultado: 'Recibido' }, { lineaId: l1._id, resultado: 'Recibido' }], w.requester.token);
      assert.equal(c2.status, 200, JSON.stringify(c2.body));
      assert.equal(c2.body.data.estado, 'Cerrada');
      const after = await call('GET', `/api/v1/repuestos/${sid(a._id)}`, w.creator.token);
      assert.equal(after.body.data.requisicion.disponibilidad, 'Disponible');
      assert.equal(after.body.data.requisicion.cantidadConfirmada, 2);
    });
  });

  describe('error envelopes, permissions and gates', () => {
    const post = (path, token, json) => call('POST', path, token, { json });

    it('dispute and close line over HTTP; list envelopes (data array + top-level pagination)', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const { body } = await post('/api/v1/repuestos/requisicion', w.creator.token, reqBody(w, [a._id], { enviar: true }));
      const id = body.data.requisicion._id;
      await post(`/api/v1/requisiciones/${id}/aprobacion/aprobar`, w.jefe.token, { version: body.data.requisicion.version });
      const lineaId = (await call('GET', `/api/v1/requisiciones/${id}`, w.creator.token)).body.data.lineas[0]._id;
      const r = await call('POST', `/api/v1/requisiciones/${id}/recepciones`, w.receiver.token, { form: recForm([{ lineaId, cantidadRecibida: 2 }]) });
      assert.equal(r.status, 201);
      const recId = r.body.data.recepciones[0]._id;
      const bad = await post(`/api/v1/requisiciones/${id}/recepciones/${recId}/confirmar`, w.requester.token, { items: [{ lineaId, resultado: 'No_Llego' }] });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.success, false);
      assert.equal(bad.body.error.code, 'OBSERVACION_REQUERIDA');
      assert.equal(typeof bad.body.message, 'string');
      const disp = await post(`/api/v1/requisiciones/${id}/recepciones/${recId}/confirmar`, w.requester.token, { items: [{ lineaId, resultado: 'No_Llego', observacion: 'No llego' }] });
      assert.equal(disp.status, 200, JSON.stringify(disp.body));
      assert.equal(disp.body.data.lineas[0].estadoLinea, 'En_Disputa');
      const repu = await call('GET', `/api/v1/repuestos/${sid(a._id)}`, w.creator.token);
      assert.equal(repu.body.data.requisicion.disponibilidad, 'En_Disputa');

      // close: motivo required (400), receive permission required (403), then ok -> cancelled (B2: every line cancelled -> the requisition ends Cancelada)
      const url = `/api/v1/requisiciones/${id}/lineas/${lineaId}/cerrar`;
      assert.equal((await post(url, w.noperm.token, { motivo: 'x' })).status, 403);
      const noMotivo = await post(url, w.receiver.token, {});
      assert.equal(noMotivo.status, 400);
      assert.equal(noMotivo.body.error.code, 'MOTIVO_REQUERIDO');
      const closed = await post(url, w.receiver.token, { motivo: 'El proveedor no entrego' });
      assert.equal(closed.status, 200, JSON.stringify(closed.body));
      assert.equal(closed.body.data.lineas[0].estadoLinea, 'Cancelada');
      assert.equal(closed.body.data.estado, 'Cancelada');
      assert.equal((await call('GET', `/api/v1/repuestos/${sid(a._id)}`, w.creator.token)).body.data.requisicion, undefined, 'released');

      const lst = await call('GET', '/api/v1/requisiciones?limit=5', w.creator.token);
      assert.ok(Array.isArray(lst.body.data));
      assert.deepEqual(keys(lst.body.pagination).filter((k) => ['limit', 'page', 'total'].includes(k)), ['limit', 'page', 'total']);
      const rl = await call('GET', '/api/v1/repuestos?limit=5', w.creator.token);
      assert.equal(rl.status, 200);
      assert.ok(Array.isArray(rl.body.data), 'GET /repuestos: data is the array');
      assert.ok(rl.body.pagination);
    });

    it('permission 403s: reception / close need requisiciones:receive; unknown query keys are 400', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const { body } = await post('/api/v1/repuestos/requisicion', w.creator.token, reqBody(w, [a._id], { enviar: true }));
      const id = body.data.requisicion._id;
      await post(`/api/v1/requisiciones/${id}/aprobacion/aprobar`, w.jefe.token, { version: body.data.requisicion.version });
      const lineaId = body.data.requisicion.lineas[0]._id;
      const denied = await call('POST', `/api/v1/requisiciones/${id}/recepciones`, w.noperm.token, { form: recForm([{ lineaId, cantidadRecibida: 1 }]) });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.success, false);
      assert.equal(typeof denied.body.error.code, 'string');
      const exceeds = await call('POST', `/api/v1/requisiciones/${id}/recepciones`, w.receiver.token, { form: recForm([{ lineaId, cantidadRecibida: 3 }]) });
      assert.equal(exceeds.status, 400);
      assert.equal(exceeds.body.error.code, 'CANTIDAD_EXCEDE');
      const badFile = await call('POST', `/api/v1/requisiciones/${id}/recepciones`, w.receiver.token, {
        form: recForm([{ lineaId, cantidadRecibida: 1 }], {}, [{ buffer: Buffer.from('MZ not an image'), type: 'application/x-msdownload', name: 'x.exe' }]),
      });
      assert.ok([400, 415].includes(badFile.status), `bad evidence rejected: ${badFile.status}`);
      assert.equal((await Requisicion.collection.findOne({ _id: new mongoose.Types.ObjectId(id) })).recepciones?.length ?? 0, 0, 'nothing stored');
      assert.equal((await call('GET', '/api/v1/requisiciones?vista=nope', w.creator.token)).status, 400);
    });

    it('POST /repuestos/ot-from-solicitudes: 409 REQUIERE_REQUISICION / SOLICITUD_NO_DISPONIBLE with the project envelope; manage-all omission', async () => {
      const w = await mkWorld();
      const bare = await mkSol(w);
      const pend = await mkSol(w);
      await post('/api/v1/repuestos/requisicion', w.creator.token, reqBody(w, [pend._id], { enviar: true }));
      const otBody = (ids, extra = {}) => ({
        repuestoIds: ids.map(sid), responsableUserIds: [w.tech.id],
        fechaInicio: new Date(Date.now() + 86400000).toISOString(), fechaFin: new Date(Date.now() + 3 * 86400000).toISOString(), ...extra,
      });
      const url = '/api/v1/repuestos/ot-from-solicitudes';
      const e1 = await post(url, w.creator.token, otBody([bare._id]));
      assert.equal(e1.status, 409, JSON.stringify(e1.body));
      assert.equal(e1.body.success, false);
      assert.equal(e1.body.error.code, 'REQUIERE_REQUISICION');
      assert.deepEqual(e1.body.error.details.ids, [sid(bare._id)]);
      const e2 = await post(url, w.creator.token, otBody([pend._id]));
      assert.equal(e2.status, 409);
      assert.equal(e2.body.error.code, 'SOLICITUD_NO_DISPONIBLE');
      const e3 = await post(url, w.creator.token, otBody([bare._id], { omitirRequisicion: true, motivoOmision: 'urgente' }));
      assert.equal(e3.status, 403, JSON.stringify(e3.body));
      const ok = await post(url, w.admin.token, otBody([bare._id], { omitirRequisicion: true, motivoOmision: 'Paciente critico' }));
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      assert.equal(ok.body.data.repuestosActualizados, 1);
    });

    it('capability gate: a tenant without the module gets 403 CAPABILITY_DISABLED and the old flow keeps working', async () => {
      const w = await mkWorld({ usesInventoryBasic: true });
      const a = await mkSol(w);
      const res = await post('/api/v1/repuestos/requisicion', w.creator.token, reqBody(w, [a._id]));
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'CAPABILITY_DISABLED');
      const read = await call('GET', '/api/v1/requisiciones', w.creator.token);
      assert.equal(read.status, 403);
      assert.equal(read.body.error.code, 'CAPABILITY_DISABLED');
      // old behaviour: install, list and OT creation work and never expose requisicion data
      const list = await call('GET', '/api/v1/repuestos', w.creator.token);
      assert.equal(list.status, 200);
      assert.equal(JSON.stringify(list.body).includes('requisicion'), false);
      assert.equal(JSON.stringify(list.body).includes('stockDescontadoPor'), false);
      const upd = await call('PUT', `/api/v1/repuestos/${sid(a._id)}`, w.creator.token, { json: { EstadoSolicitud: 'Instalado' } });
      assert.equal(upd.status, 200, JSON.stringify(upd.body));
      assert.equal(JSON.stringify(upd.body).includes('requisicion'), false);
    });

    it('cross-tenant: a token of another tenant gets 404 / 403 and the data is untouched', async () => {
      const w = await mkWorld();
      const o = await mkWorld();
      const a = await mkSol(w);
      const { body } = await post('/api/v1/repuestos/requisicion', w.creator.token, reqBody(w, [a._id]));
      const id = body.data.requisicion._id;
      assert.equal((await call('GET', `/api/v1/requisiciones/${id}`, o.admin.token)).status, 404);
      const lineaId = body.data.requisicion.lineas[0]._id;
      const r = await call('POST', `/api/v1/requisiciones/${id}/recepciones`, o.receiver.token, { form: recForm([{ lineaId, cantidadRecibida: 1 }]) });
      assert.equal(r.status, 404);
      const forged = await fetch(`${base}/api/v1/requisiciones/${id}`, { headers: { Authorization: `Bearer ${o.admin.token}`, 'x-tenant-id': w.tenantId } });
      assert.equal(forged.status, 403);
    });
  });

  // __END__
});
