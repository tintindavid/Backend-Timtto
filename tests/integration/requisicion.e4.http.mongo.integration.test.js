/**
 * Requisiciones E4 HTTP contract against a REAL MongoDB: purchase order, deliverables and the PUBLIC supplier portal, through
 * the REAL express app (src/app.js) on an ephemeral port. SKIPPED unless MONGO_INTEGRATION_URI is set; the test creates and
 * DROPS its own database `req_e4http_<random>`. E-mail, PDF microservice and notifications are stubbed; Firebase goes through
 * the existing `storageDeps` seam (no network) so the real magic-bytes validation runs.
 *
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27655 node --test tests/integration/requisicion.e4.http.mongo.integration.test.js
 */
import '../helpers/setRateLimitEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { notificationService } from '../../src/services/notification.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { requisicionEntregablesService } from '../../src/services/requisicionEntregables.service.js';
import { signToken } from '../../src/utils/jwt.util.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';
import { PDF_BYTES, mkAdjudicada, mkLicitada, out4, pricesFor, rawReq, rnd, sid, tomorrow, stubOutbound4 } from '../helpers/requisicionE4World.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0)]);
const PORTAL = '/api/v1/public/requisiciones';
const API = '/api/v1/requisiciones';
let base;
let server;

const call = async (method, path, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const type = res.headers.get('content-type') || '';
  let parsed = null;
  let raw = null;
  if (type.includes('application/json')) { try { parsed = await res.json(); } catch { /* no body */ } } else { raw = Buffer.from(await res.arrayBuffer()); }
  return { status: res.status, body: parsed, raw, type };
};
const filesForm = (files, field = 'archivos') => {
  const f = new FormData();
  for (const x of files) f.append(field, new Blob([x.buffer], { type: x.type }), x.name);
  return f;
};
const pdf = (name = 'remision.pdf') => ({ buffer: PDF_BYTES, type: 'application/pdf', name });

let seq = 0;
async function mkApiUser(tenantId, permissions) {
  seq += 1;
  const role = await Role.create({ tenantId, name: `r${seq}-${rnd()}`, permissions });
  const user = await User.create({ tenantId, email: `h${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), firstName: 'N', lastName: 'A', fullName: 'N A', roleId: role._id });
  return { user, id: sid(user._id), token: signToken({ userId: user._id, role: user.role, roleId: role._id, tenantId }) };
}

describe('Requisiciones E4 HTTP contract on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e4http_${rnd()}`;
  let savedEmit;
  let savedDeps;
  const saved = {};
  const uploads = [];

  before(async () => {
    for (const k of ['ENFORCE_TENANT_CAPABILITIES', 'RATE_LIMIT_MAX']) saved[k] = process.env[k];
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    process.env.RATE_LIMIT_MAX = '1000000';
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Customer, User, Role, Tenant, Counter]) { await m.init(); await m.syncIndexes(); }
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    stubOutbound4();
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

  /** An awarded requisition with API users of every role; the e-mail / PDF are stubbed, the storage is the real service. */
  async function world(maker = mkAdjudicada) {
    const w = await maker();
    requisicionEntregablesService.deps.storage = firebaseStorageService;
    w.issuerU = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_ISSUE_PO]);
    w.approverU = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_APPROVE_PO]);
    w.delivU = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_MANAGE_DELIVERABLES]);
    w.readerU = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ]);
    w.noneU = await mkApiUser(w.tenantId, [P.AREAS_READ]);
    w.url = `${API}/${w.reqId}`;
    return w;
  }
  const body = async (w, over = {}) => ({ lineas: await pricesFor(w.reqId), condiciones: 'Pago a 30 dias', fechaEntrega: tomorrow(), requiereEntregables: true, ...over });
  const issue = async (w, over) => call('POST', `${w.url}/orden-compra`, { token: w.issuerU.token, body: await body(w, over) });
  async function toSent(w) {
    assert.equal((await issue(w)).status, 200);
    assert.equal((await call('POST', `${w.url}/orden-compra/aprobar`, { token: w.approverU.token, body: {} })).status, 200);
    const sent = await call('POST', `${w.url}/orden-compra/enviar`, { token: w.issuerU.token, body: {} });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    w.portalToken = out4.oc.at(-1).portalUrl.split('/public/requisicion/')[1];
    return sent;
  }

  describe('purchase order (internal routes)', () => {
    it('permissions are enforced in the backend, authentication is required and the tenant comes from the token', async () => {
      const w = await world();
      const b = await body(w);
      assert.equal((await call('POST', `${w.url}/orden-compra`, { body: b })).status, 401);
      assert.equal((await call('POST', `${w.url}/orden-compra`, { token: w.noneU.token, body: b })).status, 403);
      assert.equal((await call('POST', `${w.url}/orden-compra`, { token: w.approverU.token, body: b })).status, 403, 'approve-po does not issue');
      assert.equal((await call('POST', `${w.url}/orden-compra/aprobar`, { token: w.issuerU.token, body: {} })).status, 403, 'issue-po does not approve');
      assert.equal((await call('POST', `${w.url}/orden-compra/rechazar`, { token: w.readerU.token, body: { observacion: 'x' } })).status, 403);
      assert.equal((await call('POST', `${w.url}/orden-compra/enviar`, { token: w.approverU.token, body: {} })).status, 403);
      assert.equal((await call('POST', `${w.url}/orden-compra/reenviar`, { token: w.approverU.token, body: {} })).status, 403);
      assert.equal((await call('PATCH', `${w.url}/orden-compra`, { token: w.approverU.token, body: b })).status, 403);
      for (const [m, p] of [['POST', 'entregables'], ['PATCH', 'entregables/marcar-recibidos'], ['POST', 'entregables/revisar'], ['POST', 'entregables/aceptar'], ['POST', 'entregables/devolver']]) {
        assert.equal((await call(m, `${w.url}/${p}`, { token: w.issuerU.token, body: m === 'POST' && p === 'entregables' ? undefined : { observacion: 'x' } })).status, 403, p);
      }
      const other = await mkApiUser(`o-${rnd()}`, [P.REQUISICIONES_READ, P.REQUISICIONES_ISSUE_PO, P.REQUISICIONES_APPROVE_PO, P.REQUISICIONES_MANAGE_DELIVERABLES]);
      assert.equal((await call('POST', `${w.url}/orden-compra`, { token: other.token, body: b })).status, 404, 'another tenant: 404, never 200/403');
      assert.equal((await call('GET', `${w.url}/orden-compra/pdf`, { token: other.token })).status, 404);
      assert.equal((await rawReq(w.reqId)).estado, 'Adjudicada');
    });

    it('the tenant without the module gets 403 on every new route', async () => {
      const w = await world();
      await Tenant.collection.updateOne({ tenantId: w.tenantId }, { $set: { 'capabilities.usesRequisiciones': false } });
      assert.equal((await call('POST', `${w.url}/orden-compra`, { token: w.issuerU.token, body: await body(w) })).status, 403);
      assert.equal((await call('GET', `${w.url}/orden-compra/pdf`, { token: w.readerU.token })).status, 403);
      assert.equal((await call('POST', `${w.url}/entregables/aceptar`, { token: w.delivU.token, body: {} })).status, 403);
      assert.equal((await call('GET', `${API}?vista=oc-por-aprobar`, { token: w.approverU.token })).status, 403);
    });

    it('issues with strict payloads: protected fields and bad prices are 400 and nothing changes', async () => {
      const w = await world();
      const good = await body(w);
      for (const f of ['total', 'numero', 'estado', 'emitidaPor', 'tenantId', 'version', 'exceso']) {
        const r = await call('POST', `${w.url}/orden-compra`, { token: w.issuerU.token, body: { ...good, [f]: f === 'estado' ? 'OC_Aprobada' : 1 } });
        assert.equal(r.status, 400, f);
      }
      const bad = (lineas) => call('POST', `${w.url}/orden-compra`, { token: w.issuerU.token, body: { ...good, lineas } });
      assert.equal((await bad([good.lineas[0]])).status, 400);
      assert.equal((await bad([good.lineas[0], { ...good.lineas[1], precioUnitario: -5 }])).status, 400);
      assert.equal((await bad([good.lineas[0], { ...good.lineas[1], precioUnitario: 'abc' }])).status, 400);
      assert.equal((await bad([good.lineas[0], { ...good.lineas[1], cantidad: 99 }])).status, 400);
      assert.equal((await call('POST', `${w.url}/orden-compra`, { token: w.issuerU.token, body: { ...good, requiereEntregables: undefined } })).status, 400);
      assert.equal((await call('POST', `${API}/not-an-id/orden-compra`, { token: w.issuerU.token, body: good })).status, 400);
      const raw = await rawReq(w.reqId);
      assert.equal(raw.estado, 'Adjudicada');
      assert.equal(raw.ordenCompra, undefined);
      assert.equal(await Counter.countDocuments({ tenantId: w.tenantId, key: /^ordenes-compra/ }), 0);
    });

    it('full path over HTTP: issue -> reject -> re-issue -> approve (not the issuer) -> send -> PDF', async () => {
      const w = await world();
      const issued = await issue(w);
      assert.equal(issued.status, 200, JSON.stringify(issued.body));
      assert.equal(issued.body.data.estado, 'OC_Emitida');
      const o = issued.body.data.ordenCompra;
      assert.match(o.numero, /^OC-\d{4}-0001$/);
      assert.equal(o.total, 410000);
      assert.equal(o.version, 1);
      assert.equal(o.requiereEntregables, true);
      assert.equal(o.entrega.estado, 'Pendiente');
      assert.deepEqual(Object.keys(o).sort(), ['aprobacion', 'aprobadaEn', 'aprobadaPor', 'condiciones', 'editadaPor', 'emitidaEn', 'emitidaPor', 'entrega', 'envio', 'estado', 'exceso',
        'fechaEntrega', 'lineas', 'moneda', 'numero', 'requiereEntregables', 'total', 'version']);
      assert.equal((await call('POST', `${w.url}/orden-compra/aprobar`, { token: w.issuerU.token, body: {} })).status, 403);
      // the issuer himself cannot approve even when he also holds the approve-po permission
      const both = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_ISSUE_PO, P.REQUISICIONES_APPROVE_PO]);
      const w2 = await world();
      const both2 = await mkApiUser(w2.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_ISSUE_PO, P.REQUISICIONES_APPROVE_PO]);
      assert.equal((await call('POST', `${w2.url}/orden-compra`, { token: both2.token, body: await body(w2) })).status, 200);
      const self = await call('POST', `${w2.url}/orden-compra/aprobar`, { token: both2.token, body: {} });
      assert.equal(self.status, 403);
      assert.equal(self.body.error?.code ?? self.body.code, 'SEPARACION_DE_FUNCIONES');
      assert.equal((await rawReq(w2.reqId)).estado, 'OC_Emitida');
      void both;
      const rejNo = await call('POST', `${w.url}/orden-compra/rechazar`, { token: w.approverU.token, body: { observacion: '' } });
      assert.equal(rejNo.status, 400);
      const rej = await call('POST', `${w.url}/orden-compra/rechazar`, { token: w.approverU.token, body: { observacion: 'Precio alto' } });
      assert.equal(rej.status, 200);
      assert.equal(rej.body.data.estado, 'Adjudicada');
      const again = await issue(w, { condiciones: 'Pago a 45' });
      assert.equal(again.body.data.ordenCompra.version, 2);
      assert.equal(again.body.data.ordenCompra.numero, o.numero);
      const edit = await call('PATCH', `${w.url}/orden-compra`, { token: w.issuerU.token, body: await body(w, { condiciones: 'Pago contado' }) });
      assert.equal(edit.status, 200);
      assert.equal(edit.body.data.ordenCompra.version, 3);
      const approved = await call('POST', `${w.url}/orden-compra/aprobar`, { token: w.approverU.token, body: { version: 3 } });
      assert.equal(approved.status, 200);
      assert.equal(approved.body.data.estado, 'OC_Aprobada');
      assert.equal((await call('PATCH', `${w.url}/orden-compra`, { token: w.issuerU.token, body: await body(w) })).status, 409);
      const sent = await call('POST', `${w.url}/orden-compra/enviar`, { token: w.issuerU.token, body: {} });
      assert.equal(sent.status, 200);
      assert.equal(sent.body.data.estado, 'OC_Enviada');
      assert.equal(sent.body.data.ordenCompra.envio.estadoCorreo, 'Enviado');
      assert.ok(!JSON.stringify(sent.body).includes('tokenHash'));
      const re = await call('POST', `${w.url}/orden-compra/reenviar`, { token: w.issuerU.token, body: {} });
      assert.equal(re.status, 200);
      assert.equal((await call('POST', `${w.url}/orden-compra/reenviar`, { token: w.issuerU.token, body: { correo: 'x' } })).status, 400);

      const file = await call('GET', `${w.url}/orden-compra/pdf`, { token: w.issuerU.token });
      assert.equal(file.status, 200);
      assert.equal(file.type, 'application/pdf');
      assert.ok(file.raw.equals(PDF_BYTES));
      out4.pdfFails = true;
      const down = await call('GET', `${w.url}/orden-compra/pdf`, { token: w.issuerU.token });
      out4.pdfFails = false;
      assert.equal(down.status, 502);
      assert.equal(down.body.error?.code ?? down.body.code, 'PDF_NO_DISPONIBLE');
      assert.equal((await rawReq(w.reqId)).estado, 'OC_Enviada');
    });

    it('detail visibility: the reader without purchasing permissions gets no prices; the issuer does', async () => {
      const w = await world();
      await issue(w);
      const reader = await call('GET', w.url, { token: w.readerU.token });
      assert.equal(reader.status, 200);
      assert.equal(reader.body.data.ordenCompra.total, null);
      assert.ok(reader.body.data.ordenCompra.lineas.every((l) => l.precioUnitario === null));
      assert.equal(reader.body.data.ordenCompra.estado, 'Emitida');
      const issuer = await call('GET', w.url, { token: w.issuerU.token });
      assert.equal(issuer.body.data.ordenCompra.total, 410000);
      const pdfReader = await call('GET', `${w.url}/orden-compra/pdf`, { token: w.readerU.token });
      assert.equal(pdfReader.status, 403, 'the PDF carries the real prices');
      assert.equal((await call('GET', `${w.url}/orden-compra/pdf`, { token: w.noneU.token })).status, 404, 'no read access and no participation: 404');
    });

    it('the generic edit payload cannot carry ordenCompra (400) and the OC is read-only through PATCH /:id', async () => {
      const w = await world();
      const creator = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_UPDATE]);
      const r = await call('PATCH', w.url, { token: creator.token, body: { titulo: 'x', ordenCompra: { total: 1 } } });
      assert.equal(r.status, 400);
      assert.equal((await rawReq(w.reqId)).titulo, 'Compra de sensores');
    });

    it('vista=oc-por-aprobar lists only what the caller can decide', async () => {
      const w = await world();
      await issue(w);
      const mine = await call('GET', `${API}?vista=oc-por-aprobar`, { token: w.approverU.token });
      assert.equal(mine.status, 200);
      assert.equal(mine.body.data.length, 1);
      assert.equal(mine.body.data[0]._id, w.reqId);
      assert.equal((await call('GET', `${API}?vista=oc-por-aprobar`, { token: w.issuerU.token })).body.data.length, 0);
      assert.equal((await call('GET', `${API}?vista=oc-por-aprobar`, { token: w.readerU.token })).body.data.length, 0);
    });
  });

  describe('deliverables (internal routes)', () => {
    it('upload on behalf of the supplier validates the file by its content; review, return and accept enforce the permission', async () => {
      const w = await world();
      await toSent(w);
      const url = `${w.url}/entregables`;
      const ok = await call('POST', url, { token: w.delivU.token, form: filesForm([pdf('a.pdf'), pdf('b.pdf')]) });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      assert.equal(ok.body.data.ordenCompra.entrega.estado, 'Recibidos');
      assert.equal(ok.body.data.ordenCompra.entrega.archivos.length, 2);
      assert.ok(ok.body.data.ordenCompra.entrega.archivos.every((a) => a.subidoPor === 'usuario'));
      assert.ok(!JSON.stringify(ok.body).includes('storagePath'));
      assert.equal(uploads.filter((u) => /entregables\//.test(u.path)).length >= 2, true);
      const before = (await rawReq(w.reqId)).ordenCompra.entrega.archivos.length;
      const fake = await call('POST', url, { token: w.delivU.token, form: filesForm([{ buffer: PNG, type: 'application/pdf', name: 'fake.pdf' }]) });
      assert.equal(fake.status, 400);
      const exe = await call('POST', url, { token: w.delivU.token, form: filesForm([{ buffer: Buffer.from('MZ'), type: 'application/x-msdownload', name: 'x.exe' }]) });
      assert.equal(exe.status, 400);
      const empty = await call('POST', url, { token: w.delivU.token, form: filesForm([]) });
      assert.equal(empty.status, 400);
      const six = await call('POST', url, { token: w.delivU.token, form: filesForm(Array.from({ length: 6 }, (_, i) => pdf(`f${i}.pdf`))) });
      assert.equal(six.status, 400);
      assert.equal((await rawReq(w.reqId)).ordenCompra.entrega.archivos.length, before);

      assert.equal((await call('POST', `${url}/revisar`, { token: w.issuerU.token, body: {} })).status, 403);
      const rev = await call('POST', `${url}/revisar`, { token: w.delivU.token, body: {} });
      assert.equal(rev.body.data.ordenCompra.entrega.estado, 'En_Revision');
      const noObs = await call('POST', `${url}/devolver`, { token: w.delivU.token, body: {} });
      assert.equal(noObs.status, 400);
      assert.equal((await call('POST', `${url}/devolver`, { token: w.delivU.token, body: { observacion: ' ' } })).status, 400);
      assert.equal((await rawReq(w.reqId)).ordenCompra.entrega.estado, 'En_Revision');
      const back = await call('POST', `${url}/devolver`, { token: w.delivU.token, body: { observacion: 'Falta la firma' } });
      assert.equal(back.status, 200);
      assert.equal(back.body.data.ordenCompra.entrega.estado, 'Devolucion');
      assert.equal(back.body.data.ordenCompra.entrega.ultimaObservacion, 'Falta la firma');
      const re = await call('POST', url, { token: w.delivU.token, form: filesForm([pdf('v2.pdf')]) });
      assert.equal(re.body.data.ordenCompra.entrega.estado, 'Recibidos');
      const acc = await call('POST', `${url}/aceptar`, { token: w.delivU.token, body: {} });
      assert.equal(acc.status, 200);
      assert.equal(acc.body.data.ordenCompra.entrega.estado, 'Aceptados');
      assert.equal((await call('POST', `${url}/aceptar`, { token: w.delivU.token, body: {} })).status, 409);
      assert.equal((await call('POST', `${url}/aceptar`, { token: w.delivU.token, body: { estado: 'Aceptados' } })).status, 400);
    });

    it('an OC without deliverables answers 409 ENTREGABLES_NO_REQUERIDOS; marking received works once', async () => {
      const w = await world();
      assert.equal((await issue(w, { requiereEntregables: false })).status, 200);
      await call('POST', `${w.url}/orden-compra/aprobar`, { token: w.approverU.token, body: {} });
      await call('POST', `${w.url}/orden-compra/enviar`, { token: w.issuerU.token, body: {} });
      const r = await call('PATCH', `${w.url}/entregables/marcar-recibidos`, { token: w.delivU.token, body: {} });
      assert.equal(r.status, 409);
      const w2 = await world();
      await toSent(w2);
      const m = await call('PATCH', `${w2.url}/entregables/marcar-recibidos`, { token: w2.delivU.token, body: {} });
      assert.equal(m.status, 200);
      assert.equal(m.body.data.ordenCompra.entrega.estado, 'Recibidos');
      assert.equal((await call('PATCH', `${w2.url}/entregables/marcar-recibidos`, { token: w2.delivU.token, body: {} })).status, 409);
    });
  });

  describe('public supplier portal (winner only)', () => {
    it('the winner reads the allowlisted OC, downloads the PDF and uploads deliverables through his link', async () => {
      const w = await world(mkLicitada);
      await toSent(w);
      const view = await call('GET', `${PORTAL}/${w.portalToken}`);
      assert.equal(view.status, 200);
      const oc = view.body.data.ordenCompra;
      assert.equal(oc.total, 410000);
      assert.deepEqual(Object.keys(oc).sort(), ['condiciones', 'entrega', 'fechaEntrega', 'lineas', 'moneda', 'numero', 'requiereEntregables', 'total', 'version']);
      const text = JSON.stringify(view.body);
      for (const leak of ['exceso', 'aprobacion', 'emitidaPor', 'montoEstimado', 'tokenHash', 'storagePath', 'areaId', 'solicitanteId']) assert.ok(!text.includes(leak), leak);
      const file = await call('GET', `${PORTAL}/${w.portalToken}/orden-compra/pdf`);
      assert.equal(file.status, 200);
      assert.equal(file.type, 'application/pdf');
      assert.ok(file.raw.equals(PDF_BYTES));
      const up = await call('POST', `${PORTAL}/${w.portalToken}/entregables`, { form: filesForm([pdf('remision.pdf')]) });
      assert.equal(up.status, 200, JSON.stringify(up.body));
      assert.equal(up.body.data.ordenCompra.entrega.estado, 'Recibidos');
      assert.equal(up.body.data.ordenCompra.entrega.archivos[0].subidoPor, 'proveedor');
      const bad = await call('POST', `${PORTAL}/${w.portalToken}/entregables`, { form: filesForm([{ buffer: PNG, type: 'application/pdf', name: 'fake.pdf' }]) });
      assert.equal(bad.status, 400);
      const stray = await call('POST', `${PORTAL}/${w.portalToken}/entregables`, { form: (() => { const f = filesForm([pdf()]); f.append('estado', 'Aceptados'); return f; })() });
      assert.equal(stray.status, 400, 'an extra body field is rejected');
      await call('POST', `${w.url}/entregables/revisar`, { token: w.delivU.token, body: {} });
      await call('POST', `${w.url}/entregables/devolver`, { token: w.delivU.token, body: { observacion: 'Falta factura' } });
      const seen = await call('GET', `${PORTAL}/${w.portalToken}`);
      assert.equal(seen.body.data.ordenCompra.entrega.estado, 'Devolucion');
      assert.equal(seen.body.data.ordenCompra.entrega.ultimaObservacion, 'Falta factura');
      const again = await call('POST', `${PORTAL}/${w.portalToken}/entregables`, { form: filesForm([pdf('factura.pdf')]) });
      assert.equal(again.body.data.ordenCompra.entrega.estado, 'Recibidos');
      await call('POST', `${w.url}/entregables/aceptar`, { token: w.delivU.token, body: {} });
      const locked = await call('POST', `${PORTAL}/${w.portalToken}/entregables`, { form: filesForm([pdf('late.pdf')]) });
      assert.equal(locked.status, 409);
    });

    it('before the OC is sent, for a discarded supplier and for unknown tokens: generic 404 and no OC data', async () => {
      const w = await world(mkLicitada);
      const winnerToken = w.provs[0].token;
      const loserToken = w.provs[1].token;
      assert.equal((await call('POST', `${w.url}/orden-compra`, { token: w.issuerU.token, body: await body(w) })).status, 200);
      const early = await call('GET', `${PORTAL}/${winnerToken}`);
      assert.equal(early.status, 200);
      assert.equal(early.body.data.ordenCompra, undefined);
      assert.equal((await call('GET', `${PORTAL}/${winnerToken}/orden-compra/pdf`)).status, 404);
      assert.equal((await call('POST', `${PORTAL}/${winnerToken}/entregables`, { form: filesForm([pdf()]) })).status, 404);
      await call('POST', `${w.url}/orden-compra/aprobar`, { token: w.approverU.token, body: {} });
      await call('POST', `${w.url}/orden-compra/enviar`, { token: w.issuerU.token, body: {} });
      const generic = await call('GET', `${PORTAL}/${'a'.repeat(43)}/orden-compra/pdf`);
      assert.equal(generic.status, 404);
      for (const path of ['orden-compra/pdf']) {
        const r = await call('GET', `${PORTAL}/${loserToken}/${path}`);
        assert.equal(r.status, 404);
        assert.deepEqual(r.body, generic.body, 'same body as an unknown token');
      }
      const up = await call('POST', `${PORTAL}/${loserToken}/entregables`, { form: filesForm([pdf()]) });
      assert.equal(up.status, 404);
      assert.deepEqual(up.body, generic.body);
      const page = await call('GET', `${PORTAL}/${loserToken}`);
      assert.equal(page.status, 403);
      assert.ok(!JSON.stringify(page.body).includes('ordenCompra'));
      assert.equal((await rawReq(w.reqId)).ordenCompra.entrega.archivos.length, 0);
    });

    it('a cancelled requisition expires the winner link (403 TOKEN_EXPIRADO) on every portal route', async () => {
      const w = await world();
      await toSent(w);
      const creator = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_CANCEL]);
      await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(w.reqId) }, { $set: { creadaPor: creator.user._id } });
      const c = await call('POST', `${w.url}/cancelar`, { token: creator.token, body: { motivo: 'ya no se necesita' } });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      assert.equal((await call('GET', `${PORTAL}/${w.portalToken}`)).status, 403);
      assert.equal((await call('GET', `${PORTAL}/${w.portalToken}/orden-compra/pdf`)).status, 403);
      assert.equal((await call('POST', `${PORTAL}/${w.portalToken}/entregables`, { form: filesForm([pdf()]) })).status, 403);
    });
  });

  void sid;
});
