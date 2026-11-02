/**
 * E3 round 2 (owner decision F12): visibility of supplier quotations in INTERNAL responses. The unit part runs always; the
 * HTTP part runs against the REAL app and a real MongoDB when MONGO_INTEGRATION_URI is set (own database, dropped).
 */
import '../helpers/setRateLimitEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import '../../src/models/area.model.js';
import '../../src/models/tipoRequisicion.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { requisicionLicitacionCotizacionService as cot } from '../../src/services/requisicionLicitacionCotizacion.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { redactQuotesFor, hasQuotePermission } from '../../src/utils/requisicionQuoteVisibility.util.js';
import { signToken } from '../../src/utils/jwt.util.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';
import { CAPS, mkWorld, openTender, rnd, sid, stubOutbound } from '../helpers/requisicionE3World.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const SECRET_OBS = 'oferta secreta numero uno';

describe('quote visibility: pure filter', () => {
  const req = (over = {}) => ({
    creadaPor: { _id: 'u-creator' },
    timeline: [{ tipo: 'COTIZACION_RECIBIDA', datos: { nombre: 'P', valorTotal: 5, moneda: 'COP', conArchivo: true } }],
    licitacion: { proveedores: [{ _id: 'a', nombre: 'P', correoEnvio: 'p@p.co', estadoEnvio: 'Aceptado', tieneCotizacion: true, cotizacion: { observacion: 'x', versiones: [{ observacion: 'old' }] } }, { _id: 'b', nombre: 'Q', correoEnvio: 'q@q.co', estadoEnvio: 'Enviado', tieneCotizacion: false, cotizacion: null }] },
    ...over,
  });

  it('who may see: manage-suppliers, select-winner, superadmin, the creator', () => {
    assert.equal(hasQuotePermission({ permissions: [P.REQUISICIONES_READ] }), false);
    assert.equal(hasQuotePermission({ permissions: [P.REQUISICIONES_MANAGE_SUPPLIERS] }), true);
    assert.equal(hasQuotePermission({ permissions: [P.REQUISICIONES_SELECT_WINNER] }), true);
    assert.equal(hasQuotePermission({ role: 'superadmin' }), true);
    assert.equal(hasQuotePermission(null), false);
    const r = req();
    assert.equal(redactQuotesFor(r, { userId: 'u-creator', permissions: [] }), r, 'the creator gets the object untouched');
  });

  it('others get cotizacion null, correoEnvio null, tieneCotizacion and no quote data in the timeline; names and states stay', () => {
    const out = redactQuotesFor(req(), { userId: 'u-x', permissions: [P.REQUISICIONES_READ, P.REQUISICIONES_MANAGE_ALL, P.REQUISICIONES_APPROVE] });
    assert.deepEqual(out.licitacion.proveedores.map((p) => [p.nombre, p.estadoEnvio, p.cotizacion, p.correoEnvio, p.tieneCotizacion]), [['P', 'Aceptado', null, null, true], ['Q', 'Enviado', null, null, false]]);
    assert.deepEqual(out.timeline[0].datos, { nombre: 'P', conArchivo: true });
    assert.ok(!JSON.stringify(out).includes('old'));
  });

  it('fail-closed on nested payloads (list, wrapped objects) and does not mutate the input', () => {
    const user = { userId: 'u-x', permissions: [] };
    const input = { requisicion: req(), otros: [req(), req()] };
    const before = JSON.stringify(input);
    const out = redactQuotesFor(input, user);
    assert.equal(JSON.stringify(input), before);
    assert.equal(out.requisicion.licitacion.proveedores[0].cotizacion, null);
    assert.ok(out.otros.every((r) => r.licitacion.proveedores.every((p) => p.cotizacion === null)));
    assert.deepEqual(redactQuotesFor([{ a: 1 }, null, 'x'], user), [{ a: 1 }, null, 'x']);
  });
});

describe('quote visibility: HTTP on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  let server;
  let base;
  let savedEmit;
  const saved = {};
  const call = async (method, path, token, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  let seq = 0;
  async function mkApiUser(tenantId, permissions) {
    seq += 1;
    const role = await Role.create({ tenantId, name: `r${seq}-${rnd()}`, permissions });
    const user = await User.create({ tenantId, email: `v${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), firstName: 'N', lastName: 'A', fullName: 'N A', roleId: role._id });
    return { id: sid(user._id), token: signToken({ userId: user._id, role: user.role, roleId: role._id, tenantId }) };
  }

  before(async () => {
    saved.max = process.env.RATE_LIMIT_MAX;
    await mongoose.connect(URI, { dbName: `req_e3vis_${rnd()}` });
    for (const m of [Requisicion, Customer, Tenant, User, Role]) { await m.init(); await m.syncIndexes(); }
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    const { default: app } = await import('../../src/app.js');
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
    notificationService.emit = savedEmit;
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  async function scenario() {
    stubOutbound();
    const w = await mkWorld();
    const { provs } = await openTender(w, 3);
    await cot.registrarCotizacion(w.tenantId, w.reqId, provs[0].paId, w.actor, { observacion: SECRET_OBS, valorTotal: 98765, moneda: 'COP' }, null, CAPS);
    await cot.registrarCotizacion(w.tenantId, w.reqId, provs[0].paId, w.actor, { observacion: 'segunda version', valorTotal: 90000, moneda: 'COP' }, null, CAPS);
    const users = {
      reader: await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_APPROVE]),
      buyer: await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_MANAGE_SUPPLIERS]),
      chooser: await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_SELECT_WINNER]),
      creator: await mkApiUser(w.tenantId, [P.REQUISICIONES_READ]),
      canceller: await mkApiUser(w.tenantId, [P.REQUISICIONES_READ, P.REQUISICIONES_CANCEL]),
    };
    await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(w.reqId) }, { $set: { creadaPor: new mongoose.Types.ObjectId(users.creator.id) }, $push: { timeline: { eventId: new mongoose.Types.ObjectId(), tipo: 'COTIZACION_RECIBIDA', fecha: new Date(), actor: { tipo: 'sistema' }, datos: { nombre: 'viejo', valorTotal: 11111, moneda: 'COP' } } } });
    return { w, provs, users, url: `/api/v1/requisiciones/${w.reqId}` };
  }
  const quoted = (data, provs) => data.licitacion.proveedores.find((p) => p._id === provs[0].paId);
  const other = (data, provs) => data.licitacion.proveedores.find((p) => p._id === provs[1].paId);

  it('a reader sees tieneCotizacion and names/states, but no cotizacion, no versiones, no e-mail and no value anywhere', async () => {
    const { users, url, provs } = await scenario();
    const r = await call('GET', url, users.reader.token);
    assert.equal(r.status, 200);
    const p = quoted(r.body.data, provs);
    assert.equal(p.cotizacion, null);
    assert.equal(p.tieneCotizacion, true);
    assert.equal(p.correoEnvio, null);
    assert.ok(p.nombre && p.estadoEnvio);
    assert.equal(other(r.body.data, provs).tieneCotizacion, false);
    const text = JSON.stringify(r.body);
    for (const leak of [SECRET_OBS, 'segunda version', '98765', '90000', '11111', '@prov.co']) assert.ok(!text.includes(leak), `leaks ${leak}`);
  });

  it('manage-suppliers, select-winner and the creator see everything (cotizacion, versiones, e-mail, old event data)', async () => {
    const { users, url, provs } = await scenario();
    for (const who of ['buyer', 'chooser', 'creator']) {
      const r = await call('GET', url, users[who].token);
      assert.equal(r.status, 200, who);
      const p = quoted(r.body.data, provs);
      assert.equal(p.cotizacion.observacion, 'segunda version', who);
      assert.equal(p.cotizacion.versiones[0].observacion, SECRET_OBS, who);
      assert.ok(p.correoEnvio, who);
      assert.equal(p.tieneCotizacion, true);
      assert.ok(JSON.stringify(r.body.data.timeline).includes('11111'), `${who} sees the stored event data`);
    }
  });

  it('the list honours the same rule', async () => {
    const { users, w } = await scenario();
    const list = async (who) => (await call('GET', '/api/v1/requisiciones?limit=50', users[who].token)).body.data.find((x) => x._id === w.reqId);
    const asReader = await list('reader');
    assert.ok(asReader, 'the requisition is listed');
    assert.ok(asReader.licitacion.proveedores.every((p) => p.cotizacion === null && p.correoEnvio === null));
    assert.ok(!JSON.stringify(asReader).includes(SECRET_OBS));
    const asBuyer = await list('buyer');
    assert.ok(asBuyer.licitacion.proveedores.some((p) => p.cotizacion));
  });

  it('mutation responses honour it too: a user who can only cancel gets the redacted requisition back', async () => {
    const { users, url, provs } = await scenario();
    const r = await call('POST', `${url}/cancelar`, users.canceller.token, { motivo: 'ya no se necesita' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(quoted(r.body.data, provs).cotizacion, null);
    assert.equal(quoted(r.body.data, provs).tieneCotizacion, true);
    assert.ok(!JSON.stringify(r.body).includes(SECRET_OBS));
  });

  it('the buyer\'s own mutation responses still carry the quotations; the comparison stays permission-only', async () => {
    const { users, url, provs } = await scenario();
    const q = await call('POST', `${url}/proveedores/${provs[1].paId}/cotizacion`, users.buyer.token, { observacion: 'nueva' });
    assert.equal(q.status, 201, JSON.stringify(q.body));
    assert.equal(other(q.body.data, provs).cotizacion.observacion, 'nueva');
    assert.equal((await call('GET', `${url}/licitacion/comparativo`, users.buyer.token)).status, 200);
    assert.equal((await call('GET', `${url}/licitacion/comparativo`, users.creator.token)).status, 403, 'documented: creator reads quotes in the detail, the comparison needs a purchasing permission');
    assert.equal((await call('GET', `${url}/licitacion/comparativo`, users.reader.token)).status, 403);
  });
});
