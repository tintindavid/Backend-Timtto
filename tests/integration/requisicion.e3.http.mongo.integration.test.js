/**
 * Requisiciones E3 HTTP contract against a REAL MongoDB: internal tendering routes and the PUBLIC supplier portal,
 * through the REAL express app (src/app.js) on an ephemeral port. SKIPPED unless MONGO_INTEGRATION_URI is set; the test
 * creates and DROPS its own database `req_e3http_<random>`. E-mail and notifications are stubbed; Firebase goes through
 * the existing `storageDeps` seam (no network) so the real magic-bytes validation runs.
 *
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27651 node --test tests/integration/requisicion.e3.http.mongo.integration.test.js
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
import { notificationService } from '../../src/services/notification.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { requisicionLicitacionCotizacionService } from '../../src/services/requisicionLicitacionCotizacion.service.js';
import { requisicionPortalPublicoService } from '../../src/services/requisicionPortalPublico.service.js';
import { signToken } from '../../src/utils/jwt.util.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';
import { mkProvider, mkWorld, openTender, outbox, rawReq, rnd, sid, stubOutbound, tokenFromEmail } from '../helpers/requisicionE3World.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'), Buffer.alloc(64, 0x20)]);
const PORTAL = '/api/v1/public/requisiciones';
let base;
let server;

const json = async (method, path, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (form) payload = form;
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: parsed };
};
const form = (fields = {}, file = null) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  if (file) f.append('archivo', new Blob([file.buffer], { type: file.type }), file.name);
  return f;
};

let seq = 0;
async function mkApiUser(tenantId, permissions) {
  seq += 1;
  const role = await Role.create({ tenantId, name: `r${seq}-${rnd()}`, permissions });
  const user = await User.create({ tenantId, email: `h${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), firstName: 'N', lastName: 'A', fullName: 'N A', roleId: role._id });
  return { user, id: sid(user._id), token: signToken({ userId: user._id, role: user.role, roleId: role._id, tenantId }) };
}

describe('Requisiciones E3 HTTP contract on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e3http_${rnd()}`;
  let savedEmit;
  let savedDeps;
  const saved = {};
  const uploads = [];

  before(async () => {
    for (const k of ['ENFORCE_TENANT_CAPABILITIES', 'RATE_LIMIT_MAX']) saved[k] = process.env[k];
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    process.env.RATE_LIMIT_MAX = '1000000';
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Customer, User, Role, Tenant]) { await m.init(); await m.syncIndexes(); }
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    stubOutbound();
    requisicionLicitacionCotizacionService.deps.storage = firebaseStorageService;
    requisicionPortalPublicoService.deps.storage = firebaseStorageService;
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

  /** A tender with 3 providers opened through the real internal API; returns the portal tokens by provider. */
  async function tender() {
    stubOutbound();
    requisicionLicitacionCotizacionService.deps.storage = firebaseStorageService;
    requisicionPortalPublicoService.deps.storage = firebaseStorageService;
    const w = await mkWorld();
    const buyer = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_MANAGE_SUPPLIERS]);
    const chooser = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_SELECT_WINNER]);
    const none = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ]);
    w.creatorUser = await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_SELECT_WINNER]);
    w.buyer = buyer; w.chooser = chooser; w.none = none;
    const provs = [];
    for (let i = 0; i < 3; i += 1) {
      const c = await mkProvider(w.tenantId);
      const r = await json('POST', `/api/v1/requisiciones/${w.reqId}/proveedores`, { token: buyer.token, body: { proveedorId: sid(c._id) } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      provs.push({ c, paId: r.body.data.licitacion.proveedores.find((p) => p.proveedorId === sid(c._id))._id });
    }
    const open = await json('POST', `/api/v1/requisiciones/${w.reqId}/licitacion/abrir`, { token: buyer.token, body: { fechaLimiteCotizacion: new Date(Date.now() + 5 * 86400000).toISOString() } });
    assert.equal(open.status, 200, JSON.stringify(open.body));
    w.open = open.body.data;
    w.provs = provs.map((p) => ({ ...p, token: tokenFromEmail(p.c.Email.toLowerCase()) }));
    return w;
  }

  describe('internal routes', () => {
    it('permissions are validated in the backend and the tenant comes from the token', async () => {
      const w = await tender();
      const other = await mkApiUser(`o-${rnd()}`, [P.REQUISICIONES_READ, P.REQUISICIONES_MANAGE_SUPPLIERS, P.REQUISICIONES_SELECT_WINNER]);
      const url = `/api/v1/requisiciones/${w.reqId}`;
      assert.equal((await json('POST', `${url}/proveedores`, { token: w.none.token, body: { proveedorId: w.provs[0].paId } })).status, 403);
      assert.equal((await json('POST', `${url}/licitacion/cerrar`, { token: w.none.token, body: {} })).status, 403);
      assert.equal((await json('PATCH', `${url}/proveedores/${w.provs[0].paId}/seleccionar-ganador`, { token: w.buyer.token, body: {} })).status, 403);
      assert.equal((await json('POST', `${url}/compra-directa`, { token: w.buyer.token, body: { proveedorId: w.provs[0].paId, justificacion: 'x'.repeat(30) } })).status, 403);
      assert.equal((await json('GET', `${url}/licitacion/comparativo`, { token: w.none.token })).status, 403);
      assert.equal((await json('POST', `${url}/licitacion/cerrar`, { body: {} })).status, 401);
      // another tenant's user cannot touch this requisition (404, never 403/200)
      assert.equal((await json('POST', `${url}/licitacion/cerrar`, { token: other.token, body: {} })).status, 404);
      assert.equal((await json('GET', `${url}/licitacion/comparativo`, { token: other.token })).status, 404);
    });

    it('the body cannot set internal fields (mass assignment is a 400) and no response leaks hashes or tokens', async () => {
      const w = await tender();
      const url = `/api/v1/requisiciones/${w.reqId}`;
      const c = await mkProvider(w.tenantId);
      for (const extra of [{ tenantId: 'x' }, { estado: 'Adjudicada' }, { ganadorId: w.provs[0].paId }, { tokenHash: 'a' }, { timeline: [] }]) {
        const r = await json('POST', `${url}/proveedores`, { token: w.buyer.token, body: { proveedorId: sid(c._id), ...extra } });
        assert.equal(r.status, 400, JSON.stringify(extra));
      }
      const got = await json('GET', url, { token: w.buyer.token });
      const text = JSON.stringify(got.body);
      assert.ok(!text.includes('tokenHash'));
      for (const p of w.provs) assert.ok(!text.includes(p.token), 'the clear token is never in a response');
      for (const p of got.body.data.licitacion.proveedores) assert.deepEqual(Object.keys(p).sort(), ['_id', 'correoEnvio', 'cotizacion', 'estadoEnvio', 'fechaEnvio', 'nombre', 'proveedorId', 'tieneCotizacion', 'tokenHint', 'vistasCount']);
      assert.deepEqual(Object.keys(got.body.data.licitacion).sort(), ['compraDirecta', 'fechaLimiteCotizacion', 'ganadorId', 'instrucciones', 'proveedores']);
      assert.deepEqual(Object.keys(w.open.envios).sort(), ['enviados', 'fallidos']);
    });

    it('quotation (multipart), close, comparison and winner follow the documented contract', async () => {
      const w = await tender();
      const url = `/api/v1/requisiciones/${w.reqId}`;
      const q = await json('POST', `${url}/proveedores/${w.provs[0].paId}/cotizacion`, { token: w.buyer.token, form: form({ valorTotal: 1500, moneda: 'cop', tiempoEntregaDias: 7, observacion: 'ok' }, { buffer: PDF, type: 'application/pdf', name: 'oferta.pdf' }) });
      assert.equal(q.status, 201, JSON.stringify(q.body));
      assert.match(q.body.data.licitacion.proveedores.find((p) => p._id === w.provs[0].paId).cotizacion.archivo.url, /^https:\/\/stub\.invalid\/tenants\//);
      assert.equal((await json('POST', `${url}/proveedores/${w.provs[1].paId}/cotizacion`, { token: w.buyer.token, form: form({ valorTotal: 1200, moneda: 'COP', observacion: 'b' }) })).status, 201);
      const cmp = await json('GET', `${url}/licitacion/comparativo`, { token: w.chooser.token });
      assert.equal(cmp.status, 200);
      assert.deepEqual(Object.keys(cmp.body.data).sort(), ['hayComparables', 'proveedores']);
      assert.deepEqual(Object.keys(cmp.body.data.proveedores[0]).sort(), ['archivo', 'estadoEnvio', 'fechaRespuesta', 'linkPropuesta', 'masEconomica', 'moneda', 'nombre', 'observacion', 'paId', 'tiempoEntregaDias', 'valorTotal']);
      assert.equal(cmp.body.data.proveedores.find((p) => p.masEconomica).paId, w.provs[1].paId);
      const closed = await json('POST', `${url}/licitacion/cerrar`, { token: w.buyer.token, body: {} });
      assert.equal(closed.body.data.estado, 'Cotizacion_Recibida');
      const win = await json('PATCH', `${url}/proveedores/${w.provs[1].paId}/seleccionar-ganador`, { token: w.chooser.token, body: {} });
      assert.equal(win.status, 200, JSON.stringify(win.body));
      assert.equal(win.body.data.estado, 'Adjudicada');
      assert.equal((await json('PATCH', `${url}/proveedores/${w.provs[0].paId}/seleccionar-ganador`, { token: w.chooser.token, body: {} })).body.error.code, 'GANADOR_YA_SELECCIONADO');
    });
  });

  describe('public portal: reading', () => {
    it('shows only the allowlisted fields: no prices, no internal data, no other provider', async () => {
      const w = await tender();
      const r = await json('GET', `${PORTAL}/${w.provs[0].token}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const d = r.body.data;
      assert.deepEqual(Object.keys(d).sort(), ['cerrada', 'consecutivo', 'cotizacion', 'estadoEnvio', 'fechaLimiteCotizacion', 'instrucciones', 'items', 'tenantNombre', 'titulo']);
      assert.equal(d.cerrada, false);
      assert.equal(d.cotizacion, null);
      assert.equal(d.estadoEnvio, 'Enviado');
      assert.equal(d.items.length, 2);
      for (const i of d.items) assert.deepEqual(Object.keys(i).sort(), ['cantidad', 'descripcion', 'especificacion', 'unidad']);
      const text = JSON.stringify(r.body);
      for (const forbidden of ['precio', 'montoEstimado', '120000', 'areaId', 'creadaPor', 'solicitanteId', 'aprobacion', 'timeline', 'tokenHash', 'tokenHint', 'vistas', 'correoEnvio', w.provs[1].c.Razonsocial, w.provs[2].c.Razonsocial, w.provs[0].c.Email.toLowerCase()]) {
        assert.ok(!text.includes(forbidden), `leaks ${forbidden}`);
      }
    });

    it('each provider sees only its own quotation', async () => {
      const w = await tender();
      const a = await json('PATCH', `${PORTAL}/${w.provs[0].token}/respuesta`, { form: form({ observacion: 'oferta A secreta', valorTotal: 111 }) });
      assert.equal(a.status, 200, JSON.stringify(a.body));
      const b = await json('GET', `${PORTAL}/${w.provs[1].token}`);
      assert.equal(b.body.data.cotizacion, null);
      assert.ok(!JSON.stringify(b.body).includes('oferta A secreta'));
      const own = await json('GET', `${PORTAL}/${w.provs[0].token}`);
      assert.equal(own.body.data.cotizacion.observacion, 'oferta A secreta');
      assert.equal(own.body.data.estadoEnvio, 'Aceptado');
      assert.deepEqual(Object.keys(own.body.data.cotizacion).sort(), ['archivo', 'fechaRespuesta', 'linkPropuesta', 'moneda', 'observacion', 'tiempoEntregaDias', 'valorTotal']);
    });

    it('unknown, malformed and inactive-tenant tokens give the SAME generic 404', async () => {
      const w = await tender();
      const unknown = await json('GET', `${PORTAL}/${'A'.repeat(43)}`);
      const malformed = await json('GET', `${PORTAL}/no-es-un-token`);
      await Tenant.collection.updateOne({ tenantId: w.tenantId }, { $set: { status: 'suspended' } });
      const suspended = await json('GET', `${PORTAL}/${w.provs[0].token}`);
      await Tenant.collection.updateOne({ tenantId: w.tenantId }, { $set: { status: 'active', 'capabilities.usesRequisiciones': false } });
      const noModule = await json('GET', `${PORTAL}/${w.provs[1].token}`);
      await Tenant.collection.updateOne({ tenantId: w.tenantId }, { $set: { 'capabilities.usesRequisiciones': true } });
      for (const r of [unknown, malformed, suspended, noModule]) {
        assert.equal(r.status, 404);
        assert.deepEqual(r.body, unknown.body, 'indistinguishable');
        assert.equal(r.body.error.code, 'NOT_FOUND');
      }
      assert.ok(!JSON.stringify(unknown.body).includes('stack'));
    });

    it('a discarded provider gets 403 TOKEN_EXPIRADO with no data, and the blocked access is audited with the IP', async () => {
      const w = await tender();
      for (const p of w.provs.slice(0, 2)) await json('POST', `/api/v1/requisiciones/${w.reqId}/proveedores/${p.paId}/cotizacion`, { token: w.buyer.token, form: form({ observacion: 'x' }) });
      assert.equal((await json('POST', `/api/v1/requisiciones/${w.reqId}/licitacion/cerrar`, { token: w.buyer.token, body: {} })).status, 200);
      const winId = w.provs[0].paId;
      assert.equal((await json('PATCH', `/api/v1/requisiciones/${w.reqId}/proveedores/${winId}/seleccionar-ganador`, { token: w.chooser.token, body: {} })).status, 200);
      const r = await json('GET', `${PORTAL}/${w.provs[1].token}`);
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'TOKEN_EXPIRADO');
      assert.deepEqual(Object.keys(r.body).sort(), ['error', 'message', 'success']);
      assert.ok(!JSON.stringify(r.body).includes(w.provs[1].c.Razonsocial));
      const raw = await Requisicion.collection.findOne({ _id: new mongoose.Types.ObjectId(w.reqId) });
      const entry = raw.licitacion.proveedores.find((p) => String(p._id) === w.provs[1].paId);
      assert.ok(entry.vistas.some((v) => v.bloqueada === true && v.ip));
      assert.ok(entry.vistasCount >= 1);
      // the winner can still read its own (closed) page
      const win = await json('GET', `${PORTAL}/${w.provs[0].token}`);
      assert.equal(win.status, 200);
      assert.equal(win.body.data.cerrada, true);
      assert.equal(win.body.data.estadoEnvio, 'Ganador');
    });

    it('the old link of a resent invitation is TOKEN_EXPIRADO-free 404, and a cancelled requisition expires every link', async () => {
      const w = await tender();
      const old = w.provs[0].token;
      const rs = await json('POST', `/api/v1/requisiciones/${w.reqId}/proveedores/${w.provs[0].paId}/reenviar`, { token: w.buyer.token, body: {} });
      assert.equal(rs.status, 200, JSON.stringify(rs.body));
      assert.equal((await json('GET', `${PORTAL}/${old}`)).status, 404);
      const fresh = tokenFromEmail(w.provs[0].c.Email.toLowerCase());
      assert.equal((await json('GET', `${PORTAL}/${fresh}`)).status, 200);
      const canc = await json('POST', `/api/v1/requisiciones/${w.reqId}/cancelar`, { token: (await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_CANCEL, P.REQUISICIONES_MANAGE_ALL])).token, body: { motivo: 'ya no' } });
      assert.equal(canc.status, 200, JSON.stringify(canc.body));
      for (const t of [fresh, w.provs[1].token]) {
        const r = await json('GET', `${PORTAL}/${t}`);
        assert.equal(r.status, 403);
        assert.equal(r.body.error.code, 'TOKEN_EXPIRADO');
      }
    });
  });

  describe('public portal: answering', () => {
    it('accept moves to Aceptado, a refusal expires the link; a second answer is refused', async () => {
      const w = await tender();
      const a = await json('PATCH', `${PORTAL}/${w.provs[0].token}/respuesta-invitacion`, { body: { aceptar: true } });
      assert.equal(a.status, 200, JSON.stringify(a.body));
      assert.equal(a.body.data.estadoEnvio, 'Aceptado');
      assert.equal((await json('PATCH', `${PORTAL}/${w.provs[0].token}/respuesta-invitacion`, { body: { aceptar: true } })).status, 409);
      const r = await json('PATCH', `${PORTAL}/${w.provs[1].token}/respuesta-invitacion`, { body: { aceptar: false } });
      assert.equal(r.status, 200);
      const again = await json('PATCH', `${PORTAL}/${w.provs[1].token}/respuesta-invitacion`, { body: { aceptar: true } });
      assert.equal(again.status, 403);
      assert.equal(again.body.error.code, 'TOKEN_EXPIRADO');
      const raw = await rawReq(w.reqId);
      const ev = raw.timeline.filter((e) => e.tipo === 'INVITACION_ACEPTADA' || e.tipo === 'INVITACION_RECHAZADA');
      assert.equal(ev.length, 2);
      assert.ok(ev.every((e) => e.actor.tipo === 'proveedor' && e.actor.nombreExterno && !e.actor.usuarioId));
      assert.equal((await json('PATCH', `${PORTAL}/${w.provs[2].token}/respuesta-invitacion`, { body: { aceptar: 'si' } })).status, 400);
    });

    it('stores a valid PDF quotation as origin portal with an external actor and notifies the team', async () => {
      const w = await tender();
      const r = await json('PATCH', `${PORTAL}/${w.provs[0].token}/respuesta`, { form: form({ observacion: 'incluye IVA', valorTotal: 2500, moneda: 'cop', tiempoEntregaDias: 5 }, { buffer: PDF, type: 'application/pdf', name: 'Oferta ../../x.pdf' }) });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.estadoEnvio, 'Aceptado');
      assert.match(r.body.data.cotizacion.archivo.url, /^https:\/\/stub\.invalid\/tenants\/.*\/cotizaciones\//);
      assert.ok(!r.body.data.cotizacion.archivo.nombre.includes('/'), 'the file name is sanitised');
      assert.equal(r.body.data.cotizacion.moneda, 'COP');
      const raw = await rawReq(w.reqId);
      const e = raw.timeline.find((x) => x.tipo === 'COTIZACION_RECIBIDA');
      assert.equal(e.actor.tipo, 'proveedor');
      assert.equal(raw.licitacion.proveedores.find((p) => String(p._id) === w.provs[0].paId).cotizacion.origen, 'portal');
      assert.ok(!JSON.stringify(raw.timeline).includes(w.provs[0].token));
      assert.ok(outbox.notify.some((n) => n.event === 'requisicion.quote.received'));
    });

    it('rejects fake files, oversized files, other types, insecure links, empty quotations and extra fields', async () => {
      const w = await tender();
      const url = `${PORTAL}/${w.provs[0].token}/respuesta`;
      const fake = await json('PATCH', url, { form: form({}, { buffer: Buffer.from('esto no es un pdf'), type: 'application/pdf', name: 'a.pdf' }) });
      assert.equal(fake.status, 400);
      assert.equal(fake.body.error.code, 'FILE_CONTENT_MISMATCH');
      const big = await json('PATCH', url, { form: form({}, { buffer: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), type: 'application/pdf', name: 'big.pdf' }) });
      assert.equal(big.status, 400);
      const exe = await json('PATCH', url, { form: form({}, { buffer: Buffer.from('MZ'), type: 'application/x-msdownload', name: 'a.exe' }) });
      assert.equal(exe.status, 400);
      assert.equal((await json('PATCH', url, { form: form({ linkPropuesta: 'http://inseguro.co/x' }) })).body.error.code, 'LINK_INVALIDO');
      assert.equal((await json('PATCH', url, { form: form({ linkPropuesta: 'javascript:alert(1)' }) })).body.error.code, 'LINK_INVALIDO');
      assert.equal((await json('PATCH', url, { form: form({}) })).body.error.code, 'COTIZACION_VACIA');
      for (const extra of [{ estadoEnvio: 'Ganador' }, { estado: 'Adjudicada' }, { tenantId: 'x' }, { tokenHash: 'x' }, { ganadorId: 'x' }, { origen: 'interno' }]) {
        const r = await json('PATCH', url, { form: form({ observacion: 'ok', ...extra }) });
        assert.equal(r.status, 400, JSON.stringify(extra));
      }
      const two = form({ observacion: 'ok' }, { buffer: PDF, type: 'application/pdf', name: 'a.pdf' });
      two.append('archivo', new Blob([PDF], { type: 'application/pdf' }), 'b.pdf');
      assert.equal((await json('PATCH', url, { form: two })).status, 400);
      const raw = await rawReq(w.reqId);
      assert.ok(raw.licitacion.proveedores.every((p) => !p.cotizacion), 'nothing was stored');
      assert.equal(raw.licitacion.proveedores.find((p) => String(p._id) === w.provs[0].paId).estadoEnvio, 'Enviado');
    });

    it('after the deadline: GET shows closed, the answer is 403 FECHA_LIMITE_VENCIDA', async () => {
      const w = await tender();
      const past = new Date(Date.now() - 60000);
      await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(w.reqId) }, { $set: { 'licitacion.fechaLimiteCotizacion': past, 'licitacion.proveedores.$[].tokenVence': past } });
      const g = await json('GET', `${PORTAL}/${w.provs[0].token}`);
      assert.equal(g.status, 200);
      assert.equal(g.body.data.cerrada, true);
      const r = await json('PATCH', `${PORTAL}/${w.provs[0].token}/respuesta`, { form: form({ observacion: 'tarde' }) });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, 'FECHA_LIMITE_VENCIDA');
      assert.equal((await json('PATCH', `${PORTAL}/${w.provs[0].token}/respuesta-invitacion`, { body: { aceptar: true } })).body.error.code, 'FECHA_LIMITE_VENCIDA');
    });
  });

  describe('public portal: rate limits (run last: they share the IP bucket)', () => {
    it('limits per IP + token and answers 429 BEFORE touching the database', async () => {
      const token = 'B'.repeat(43);
      let dbCalls = 0;
      const realAggregate = Requisicion.aggregate;
      Requisicion.aggregate = (...args) => { dbCalls += 1; return realAggregate.apply(Requisicion, args); };
      try {
        let last;
        for (let i = 0; i < 26; i += 1) last = await json('GET', `${PORTAL}/${token}`);
        assert.equal(last.status, 429);
        assert.equal(last.body.error.code, 'RATE_LIMIT_REQUISICION_PORTAL');
        const before = dbCalls;
        await json('GET', `${PORTAL}/${token}`);
        assert.equal(dbCalls, before, 'a limited request never reaches the database');
        assert.ok(before <= 20, `only the allowed requests reached the database (${before})`);
        // another token from the same IP is still served by the narrow limiter
        assert.equal((await json('GET', `${PORTAL}/${'C'.repeat(43)}`)).status, 404);
      } finally {
        Requisicion.aggregate = realAggregate;
      }
    });
  });
});
