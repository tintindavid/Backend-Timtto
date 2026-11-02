/**
 * requisiciones-e3-compras-portal, task 2.5 (unit): validations, tenant scoping, 404/409 branches, simulated concurrency
 * and the permission of every internal tendering route. The writes themselves (arrayFilters, atomicity) are covered
 * against a real MongoDB in tests/integration/requisicion.e3.*.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { requisicionLicitacionService as lic, validateFechaLimite } from '../../src/services/requisicionLicitacion.service.js';
import { requisicionLicitacionCotizacionService as cot, normalizeCotizacionInput } from '../../src/services/requisicionLicitacionCotizacion.service.js';
import { requisicionGanadorService as gan } from '../../src/services/requisicionGanador.service.js';
import router from '../../src/routes/requisicion.routes.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';

const CAPS = { usesRequisiciones: true };
const oid = () => new mongoose.Types.ObjectId();
const T = 'tenant-a';
const actor = { userId: String(oid()), name: 'Comprador' };

const q = (val) => ({ lean: async () => val, select() { return this; } });
const ev = (e) => assert.ok(e);
const saved = {};
let docs;
let calls;

function mkDoc(over = {}) {
  return { _id: oid(), tenantId: T, estado: 'Aprobada', creadaPor: oid(), consecutivo: 'REQ-1', licitacion: { proveedores: [] }, ...over };
}
const prov = (over = {}) => ({ _id: oid(), proveedorId: oid(), nombre: 'P', correoEnvio: 'p@p.co', estadoEnvio: 'Pendiente', ...over });

beforeEach(() => {
  calls = { appendEvent: [], emails: [] };
  docs = new Map();
  Object.assign(saved, { findOne: Requisicion.findOne, appendEvent: Requisicion.appendEvent, cFindOne: Customer.findOne, populate: Requisicion.populate, tFindOne: Tenant.findOne, email: lic.deps.email, notify: lic.deps.notify, gnotify: gan.deps.notify, gsync: gan.deps.sync, gemail: gan.deps.email });
  Requisicion.findOne = (filter) => {
    const d = docs.get(String(filter._id));
    return q(d && filter.tenantId === d.tenantId ? d : null);
  };
  Requisicion.appendEvent = async (filter, events, extra) => { calls.appendEvent.push({ filter, events, extra }); return null; };
  Requisicion.populate = async (plain) => plain;
  Tenant.findOne = () => q({ name: 'T' });
  lic.deps.email = { sendRequisicionRfqInvitationEmail: async (a) => { calls.emails.push(a); return { sent: true }; } };
  lic.deps.notify = ev;
  lic.deps.envio = { NOTIFICATIONS_ENABLED: true, NODE_ENV: 'test', PUBLIC_APP_URL: 'https://app.test' };
  gan.deps.notify = ev;
  gan.deps.sync = async () => {};
  gan.deps.email = { sendRequisicionAwardEmail: async () => ({ sent: true }) };
});

afterEach(() => {
  Requisicion.findOne = saved.findOne;
  Requisicion.appendEvent = saved.appendEvent;
  Customer.findOne = saved.cFindOne;
  Requisicion.populate = saved.populate;
  Tenant.findOne = saved.tFindOne;
  lic.deps.email = saved.email; lic.deps.notify = saved.notify;
  gan.deps.notify = saved.gnotify; gan.deps.sync = saved.gsync; gan.deps.email = saved.gemail;
});

const api = async (promise, status, code) => {
  let err;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, `expected ${status} ${code}`);
  assert.equal(err.statusCode, status, `${err.statusCode} ${err.code} ${err.message}`);
  if (code) assert.equal(err.code, code);
};

describe('deadline and quotation input validation', () => {
  it('the deadline must be a future date within 90 days', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    assert.ok(validateFechaLimite('2026-11-10T00:00:00Z', now) instanceof Date);
    for (const bad of [undefined, null, 'x', '2026-10-01T00:00:00Z', '2026-11-01T12:00:00Z', '2027-03-01T00:00:00Z']) {
      assert.throws(() => validateFechaLimite(bad, now), (e) => e.code === 'FECHA_LIMITE_INVALIDA' && e.statusCode === 400, String(bad));
    }
  });

  it('a quotation needs a file, an https link or an observation; values are validated', () => {
    assert.throws(() => normalizeCotizacionInput({}, false), (e) => e.code === 'COTIZACION_VACIA');
    assert.throws(() => normalizeCotizacionInput({ valorTotal: 5 }, false), (e) => e.code === 'COTIZACION_VACIA');
    assert.deepEqual(normalizeCotizacionInput({}, true), {});
    for (const link of ['http://x.co', 'javascript:alert(1)', 'ftp://x.co/a', 'https://a b.co', 'no-url']) {
      assert.throws(() => normalizeCotizacionInput({ linkPropuesta: link }), (e) => e.code === 'LINK_INVALIDO', link);
    }
    assert.equal(normalizeCotizacionInput({ linkPropuesta: 'https://x.co/o.pdf' }).linkPropuesta, 'https://x.co/o.pdf');
    assert.throws(() => normalizeCotizacionInput({ observacion: 'a', valorTotal: -1 }), (e) => e.code === 'VALOR_INVALIDO');
    assert.throws(() => normalizeCotizacionInput({ observacion: 'a', moneda: 'P$' }), (e) => e.code === 'MONEDA_INVALIDA');
    assert.throws(() => normalizeCotizacionInput({ observacion: 'a', tiempoEntregaDias: 1.5 }), (e) => e.code === 'TIEMPO_ENTREGA_INVALIDO');
    assert.deepEqual(normalizeCotizacionInput({ observacion: ' hola ', valorTotal: '12.5', moneda: 'cop', tiempoEntregaDias: '3' }), { observacion: 'hola', valorTotal: 12.5, moneda: 'COP', tiempoEntregaDias: 3 });
  });
});

describe('assign / open', () => {
  it('404 for a requisition of another tenant, 409 for a wrong state, 403 with the module off', async () => {
    const d = mkDoc();
    docs.set(String(d._id), d);
    const body = { proveedorId: String(oid()) };
    await api(lic.asignarProveedor('tenant-b', d._id, actor, body, CAPS), 404, 'REQUISICION_NOT_FOUND');
    await api(lic.asignarProveedor(T, d._id, actor, body, { usesRequisiciones: false }), 403, 'CAPABILITY_DISABLED');
    docs.set(String(d._id), { ...d, estado: 'Borrador' });
    await api(lic.asignarProveedor(T, d._id, actor, body, CAPS), 409, 'TRANSICION_INVALIDA');
    docs.set(String(d._id), { ...d, estado: 'Adjudicada' });
    await api(lic.asignarProveedor(T, d._id, actor, body, CAPS), 409, 'TRANSICION_INVALIDA');
    assert.equal(calls.appendEvent.length, 0);
  });

  it('the provider must be a `provider` of the SAME tenant (the catalogue query is tenant-scoped)', async () => {
    const d = mkDoc();
    docs.set(String(d._id), d);
    let filter;
    Customer.findOne = (f) => { filter = f; return q(null); };
    await api(lic.asignarProveedor(T, d._id, actor, { proveedorId: String(oid()) }, CAPS), 400, 'PROVEEDOR_INVALIDO');
    assert.equal(filter.tenantId, T);
    assert.equal(filter.kind, 'provider');
  });

  it('a valid assignment is ONE conditional write guarding state, duplicates and the cap; the event holds no token or e-mail', async () => {
    const d = mkDoc();
    docs.set(String(d._id), d);
    const c = { _id: oid(), Razonsocial: 'Prov SA', Email: 'ventas@prov.co' };
    Customer.findOne = () => q(c);
    await api(lic.asignarProveedor(T, d._id, actor, { proveedorId: String(c._id) }, CAPS), 409, 'CONFLICTO_CONCURRENTE');
    const { filter, events, extra } = calls.appendEvent[0];
    assert.equal(filter.tenantId, T);
    assert.deepEqual(filter.estado, { $in: ['Aprobada', 'En_Licitacion'] });
    assert.ok(filter['licitacion.proveedores'].$not.$elemMatch);
    assert.ok(filter['licitacion.proveedores.24'].$exists === false);
    const entry = extra.push['licitacion.proveedores'].$each[0];
    assert.equal(entry.estadoEnvio, 'Pendiente');
    assert.equal(entry.tokenHash.length, 64);
    assert.equal(entry.correoEnvio, 'ventas@prov.co');
    assert.ok(!JSON.stringify(events).includes(entry.tokenHash) && !JSON.stringify(events).includes('ventas@prov.co'));
  });

  it('duplicates and the cap are reported from a re-read when the guarded write misses', async () => {
    const c = { _id: oid(), Razonsocial: 'Prov', Email: 'a@b.co' };
    Customer.findOne = () => q(c);
    const dup = mkDoc({ licitacion: { proveedores: [prov({ proveedorId: c._id })] } });
    docs.set(String(dup._id), dup);
    await api(lic.asignarProveedor(T, dup._id, actor, { proveedorId: String(c._id) }, CAPS), 409, 'PROVEEDOR_DUPLICADO');
    const full = mkDoc({ licitacion: { proveedores: Array.from({ length: 25 }, () => prov()) } });
    docs.set(String(full._id), full);
    await api(lic.asignarProveedor(T, full._id, actor, { proveedorId: String(c._id) }, CAPS), 400, 'LIMITE_PROVEEDORES');
  });

  it('opening needs 2 active providers with a valid e-mail and sends nothing otherwise', async () => {
    const d = mkDoc({ licitacion: { proveedores: [prov(), prov({ correoEnvio: 'sin-arroba' }), prov({ estadoEnvio: 'Rechazado' })] } });
    docs.set(String(d._id), d);
    const fecha = new Date(Date.now() + 86400000).toISOString();
    await api(lic.abrir(T, d._id, actor, { fechaLimiteCotizacion: fecha }, CAPS), 400, 'PROVEEDORES_INSUFICIENTES');
    await api(lic.abrir(T, d._id, actor, {}, CAPS), 400, 'FECHA_LIMITE_INVALIDA');
    docs.set(String(d._id), { ...d, estado: 'En_Licitacion' });
    await api(lic.abrir(T, d._id, actor, { fechaLimiteCotizacion: fecha }, CAPS), 409, 'TRANSICION_INVALIDA');
    assert.equal(calls.emails.length, 0);
    assert.equal(calls.appendEvent.length, 0);
  });

  it('resend and quotation need an open tender and an active provider', async () => {
    const p = prov({ estadoEnvio: 'Descartado' });
    const d = mkDoc({ estado: 'En_Licitacion', licitacion: { fechaLimiteCotizacion: new Date(Date.now() + 1e7), proveedores: [p] } });
    docs.set(String(d._id), d);
    await api(lic.reenviar(T, d._id, p._id, actor, {}, CAPS), 409, 'PROVEEDOR_INACTIVO');
    await api(cot.registrarCotizacion(T, d._id, p._id, actor, { observacion: 'x' }, null, CAPS), 409, 'PROVEEDOR_INACTIVO');
    await api(lic.reenviar(T, d._id, oid(), actor, {}, CAPS), 404, 'PROVEEDOR_NO_ENCONTRADO');
    docs.set(String(d._id), { ...d, estado: 'Aprobada' });
    await api(lic.reenviar(T, d._id, p._id, actor, {}, CAPS), 409, 'TRANSICION_INVALIDA');
    await api(cot.cerrar(T, d._id, actor, CAPS), 409, 'TRANSICION_INVALIDA');
  });
});

describe('comparison', () => {
  const quoted = (valorTotal, moneda) => prov({ estadoEnvio: 'Aceptado', cotizacion: { observacion: 'x', valorTotal, moneda, origen: 'portal', registradaPor: oid() } });
  const compare = async (list) => { const d = mkDoc({ licitacion: { proveedores: list } }); docs.set(String(d._id), d); return cot.comparativo(T, d._id); };

  it('highlights the lowest total only when every quotation has a value in the same currency', async () => {
    const a = quoted(900, 'COP'); const b = quoted(700, 'COP');
    const r = await compare([a, b, prov({ estadoEnvio: 'Enviado' })]);
    assert.equal(r.hayComparables, true);
    assert.deepEqual(r.proveedores.filter((p) => p.masEconomica).map((p) => p.paId), [String(b._id)]);
    assert.ok(r.proveedores.every((p) => !('origen' in p) && !('registradaPor' in p)));
    for (const list of [[quoted(900, 'COP'), quoted(700, 'USD')], [quoted(900, 'COP'), quoted(undefined, 'COP')], [quoted(900, 'COP')], [quoted(900), quoted(800)]]) {
      const x = await compare(list);
      assert.equal(x.hayComparables, false);
      assert.ok(x.proveedores.every((p) => p.masEconomica === false));
    }
  });

  it('another tenant gets 404', async () => {
    const d = mkDoc();
    docs.set(String(d._id), d);
    await api(cot.comparativo('tenant-b', d._id), 404, 'REQUISICION_NOT_FOUND');
  });
});

describe('winner and direct purchase', () => {
  const quoted = () => prov({ estadoEnvio: 'Aceptado', cotizacion: { observacion: 'x', origen: 'portal' } });

  it('refuses a second selection, a provider without quotation and a wrong state', async () => {
    const win = quoted(); const none = prov({ estadoEnvio: 'Enviado' });
    const d = mkDoc({ estado: 'Cotizacion_Recibida', licitacion: { proveedores: [win, none] } });
    docs.set(String(d._id), d);
    await api(gan.seleccionarGanador(T, d._id, none._id, actor, CAPS), 400, 'PROVEEDOR_SIN_COTIZACION');
    await api(gan.seleccionarGanador(T, d._id, oid(), actor, CAPS), 404, 'PROVEEDOR_NO_ENCONTRADO');
    docs.set(String(d._id), { ...d, estado: 'En_Licitacion' });
    await api(gan.seleccionarGanador(T, d._id, win._id, actor, CAPS), 409, 'TRANSICION_INVALIDA');
    docs.set(String(d._id), { ...d, estado: 'Adjudicada', licitacion: { ganadorId: win._id, proveedores: [win, none] } });
    await api(gan.seleccionarGanador(T, d._id, win._id, actor, CAPS), 409, 'GANADOR_YA_SELECCIONADO');
    await api(gan.seleccionarGanador('tenant-b', d._id, win._id, actor, CAPS), 404, 'REQUISICION_NOT_FOUND');
  });

  it('simulated race: both selections pass the read, the single guarded write lets ONE win, the other gets 409 GANADOR_YA_SELECCIONADO', async () => {
    const a = quoted(); const b = quoted();
    const d = mkDoc({ estado: 'Cotizacion_Recibida', licitacion: { proveedores: [a, b] } });
    docs.set(String(d._id), d);
    let wrote = false;
    Requisicion.appendEvent = async (filter) => {
      calls.appendEvent.push({ filter });
      await new Promise((r) => setTimeout(r, 5));
      if (wrote) { docs.set(String(d._id), { ...d, estado: 'Adjudicada', licitacion: { ganadorId: a._id, proveedores: [a, b] } }); return null; }
      wrote = true;
      return { toObject: () => ({ ...d, estado: 'Adjudicada' }) };
    };
    const out = await Promise.allSettled([gan.seleccionarGanador(T, d._id, a._id, actor, CAPS), gan.seleccionarGanador(T, d._id, b._id, actor, CAPS)]);
    assert.equal(out.filter((o) => o.status === 'fulfilled').length, 1);
    const lost = out.find((o) => o.status === 'rejected');
    assert.equal(lost.reason.code, 'GANADOR_YA_SELECCIONADO');
    const f = calls.appendEvent[0].filter;
    assert.equal(f['licitacion.ganadorId'], null, 'the write is conditioned to ganadorId = null');
    assert.equal(f.estado, 'Cotizacion_Recibida');
    assert.equal(f.tenantId, T);
  });

  it('direct purchase: creator refused, short justification, wrong state, wrong provider', async () => {
    const d = mkDoc();
    docs.set(String(d._id), d);
    const long = 'Unico proveedor homologado por el fabricante';
    const asCreator = { userId: String(d.creadaPor), name: 'c' };
    await api(gan.compraDirecta(T, d._id, asCreator, { proveedorId: String(oid()), justificacion: long }, CAPS), 403, 'SEPARACION_FUNCIONES');
    await api(gan.compraDirecta(T, d._id, actor, { proveedorId: String(oid()), justificacion: 'corta' }, CAPS), 400, 'JUSTIFICACION_CORTA');
    await api(gan.compraDirecta(T, d._id, actor, { proveedorId: String(oid()), justificacion: ' '.repeat(30) }, CAPS), 400, 'JUSTIFICACION_CORTA');
    Customer.findOne = () => q(null);
    await api(gan.compraDirecta(T, d._id, actor, { proveedorId: String(oid()), justificacion: long }, CAPS), 400, 'PROVEEDOR_INVALIDO');
    docs.set(String(d._id), { ...d, estado: 'Cotizacion_Recibida' });
    await api(gan.compraDirecta(T, d._id, actor, { proveedorId: String(oid()), justificacion: long }, CAPS), 409, 'TRANSICION_INVALIDA');
    await api(gan.compraDirecta('tenant-b', d._id, actor, { proveedorId: String(oid()), justificacion: long }, CAPS), 404, 'REQUISICION_NOT_FOUND');
  });
});

describe('route permissions (validated in the backend)', () => {
  const routes = router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0], path: l.route.path, handlers: l.route.stack.map((s) => s.handle) }));
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);
  const check = (handler, permissions) => new Promise((resolve) => handler({ user: { role: 'user', permissions } }, {}, (err) => resolve(err)));

  const table = [
    ['post', '/:id/proveedores', P.REQUISICIONES_MANAGE_SUPPLIERS],
    ['delete', '/:id/proveedores/:paId', P.REQUISICIONES_MANAGE_SUPPLIERS],
    ['post', '/:id/licitacion/abrir', P.REQUISICIONES_MANAGE_SUPPLIERS],
    ['post', '/:id/proveedores/:paId/reenviar', P.REQUISICIONES_MANAGE_SUPPLIERS],
    ['post', '/:id/proveedores/:paId/cotizacion', P.REQUISICIONES_MANAGE_SUPPLIERS],
    ['post', '/:id/licitacion/cerrar', P.REQUISICIONES_MANAGE_SUPPLIERS],
    ['patch', '/:id/licitacion/fecha-limite', P.REQUISICIONES_MANAGE_SUPPLIERS],
    ['patch', '/:id/proveedores/:paId/seleccionar-ganador', P.REQUISICIONES_SELECT_WINNER],
    ['post', '/:id/compra-directa', P.REQUISICIONES_SELECT_WINNER],
  ];
  for (const [method, path, permission] of table) {
    it(`${method.toUpperCase()} ${path} requires ${permission}`, async () => {
      const route = find(method, path);
      assert.ok(route, 'route is mounted');
      assert.equal((await check(route.handlers[0], [])).statusCode, 403);
      assert.equal((await check(route.handlers[0], [P.REQUISICIONES_READ, P.REQUISICIONES_MANAGE_ALL])).statusCode, 403);
      assert.equal(await check(route.handlers[0], [permission]), undefined);
    });
  }

  it('the comparison is readable with either purchasing permission, not without', async () => {
    const route = find('get', '/:id/licitacion/comparativo');
    assert.equal((await check(route.handlers[0], [P.REQUISICIONES_READ])).statusCode, 403);
    assert.equal(await check(route.handlers[0], [P.REQUISICIONES_MANAGE_SUPPLIERS]), undefined);
    assert.equal(await check(route.handlers[0], [P.REQUISICIONES_SELECT_WINNER]), undefined);
  });
});
