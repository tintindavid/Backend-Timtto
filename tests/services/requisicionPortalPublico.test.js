/**
 * requisiciones-e3-compras-portal, task 4.5 (unit): public supplier portal security rules with stubbed persistence.
 * (The HTTP contract against the real app and database lives in tests/integration/requisicion.e3.http.*.)
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { requisicionPortalPublicoService as portal } from '../../src/services/requisicionPortalPublico.service.js';
import { generateProveedorToken, hashToken, isPlausibleToken, buildPortalLink } from '../../src/utils/requisicionToken.util.js';
import { toPortalDto } from '../../src/utils/requisicionPortalDto.util.js';
import { portalRespuestaDto, portalRespuestaInvitacionDto } from '../../src/dtos/requisicionLicitacion.dto.js';
import { redactSensitiveUrl } from '../../src/utils/redactUrl.util.js';
import { PORTAL_MENSAJE_NO_ENCONTRADO, PORTAL_MENSAJE_TOKEN_EXPIRADO } from '../../src/constants/requisicion.constants.js';

const oid = () => new mongoose.Types.ObjectId();
const NOW = new Date('2026-11-01T12:00:00Z');
const FUTURE = new Date('2026-11-10T12:00:00Z');
const PAST = new Date('2026-10-30T12:00:00Z');
const q = (val) => ({ lean: async () => val, select() { return this; } });

let tok;
let state;
const saved = {};

function row(over = {}, prov = {}) {
  return {
    _id: oid(), tenantId: 't1', consecutivo: 'REQ-1', titulo: 'Sensores', descripcion: 'Para el servicio', estado: 'En_Licitacion', fechaLimiteCotizacion: FUTURE,
    items: [{ descripcion: 'Sensor', cantidad: 3, unidad: 'und', especificacion: 'x' }],
    proveedor: { _id: oid(), nombre: 'Prov SA', estadoEnvio: 'Enviado', tokenVence: FUTURE, ...prov },
    ...over,
  };
}

beforeEach(() => {
  tok = generateProveedorToken();
  state = { row: row(), tenant: { name: 'Clinica', status: 'active', capabilities: { usesRequisiciones: true } }, pipelines: [], views: [], writes: [], appendResult: { toObject: () => ({}) } };
  Object.assign(saved, { aggregate: Requisicion.aggregate, updateOne: Requisicion.updateOne, appendEvent: Requisicion.appendEvent, findOne: Requisicion.findOne, tFindOne: Tenant.findOne, now: portal.deps.now, notify: portal.deps.notify, storage: portal.deps.storage });
  Requisicion.aggregate = async (pipeline) => { state.pipelines.push(pipeline); return state.row ? [state.row] : []; };
  Requisicion.updateOne = async (filter, update, options) => { state.views.push({ filter, update, options }); return { matchedCount: 1 }; };
  Requisicion.appendEvent = async (filter, events, extra) => { state.writes.push({ filter, events, extra }); return state.appendResult; };
  Requisicion.findOne = () => q(null); // maybeAutoClose reads through this: nothing to close
  Tenant.findOne = () => q(state.tenant);
  portal.deps.now = () => NOW;
  portal.deps.notify = () => {};
  portal.deps.storage = { uploadRequisicionCotizacion: async () => ({ url: 'https://f.test/a.pdf', nombre: 'a.pdf', tipo: 'application/pdf', tamano: 3, storagePath: 'p/a' }), deleteByPath: async (p) => { state.deleted = p; } };
});

afterEach(() => {
  Requisicion.aggregate = saved.aggregate; Requisicion.updateOne = saved.updateOne; Requisicion.appendEvent = saved.appendEvent; Requisicion.findOne = saved.findOne;
  Tenant.findOne = saved.tFindOne; portal.deps.now = saved.now; portal.deps.notify = saved.notify; portal.deps.storage = saved.storage;
});

const fails = async (promise) => { try { await promise; } catch (e) { return e; } assert.fail('expected rejection'); };

describe('tokens', () => {
  it('32 random bytes in base64url, hash + 4-char hint, link from PUBLIC_APP_URL', () => {
    const a = generateProveedorToken(); const b = generateProveedorToken();
    assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a.token, b.token);
    assert.equal(a.tokenHash, hashToken(a.token));
    assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(a.tokenHash, a.token);
    assert.equal(a.tokenHint, a.token.slice(-4));
    assert.equal(isPlausibleToken(a.token), true);
    for (const bad of [undefined, null, '', 'abc', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}!`, 123, {}]) assert.equal(isPlausibleToken(bad), false);
    assert.equal(buildPortalLink(a.token, 'https://app.timtto.com/'), `https://app.timtto.com/public/requisicion/${a.token}`);
  });

  it('access-log redaction covers the portal route and the SPA page', () => {
    assert.ok(!redactSensitiveUrl(`/api/v1/public/requisiciones/${tok.token}/respuesta`).includes(tok.token));
    assert.ok(!redactSensitiveUrl(`/public/requisicion/${tok.token}`).includes(tok.token));
  });
});

describe('resolving a token', () => {
  it('a malformed token is the generic 404 without touching the database', async () => {
    for (const bad of ['x', 'A'.repeat(44), undefined]) {
      const e = await fails(portal.resolve(bad, { ip: '1.1.1.1' }));
      assert.equal(e.statusCode, 404);
      assert.equal(e.code, 'NOT_FOUND');
    }
    assert.equal(state.pipelines.length, 0);
  });

  it('the lookup uses the hash only and the projection carries no price nor other supplier', async () => {
    await portal.resolve(tok.token, { ip: '1.1.1.1' });
    const text = JSON.stringify(state.pipelines[0]);
    assert.ok(text.includes(hashToken(tok.token)));
    assert.ok(!text.includes(tok.token));
    for (const forbidden of ['precioEstimado', 'montoEstimado', 'creadaPor', 'solicitanteId', 'areaId', 'aprobacion', 'timeline', 'tokenHash":1', 'vistas']) {
      assert.ok(!text.includes(forbidden), `projection mentions ${forbidden}`);
    }
  });

  it('unknown token, inactive tenant, tenant without the module and a non-tender state are indistinguishable (same generic 404)', async () => {
    state.row = null;
    const unknown = await fails(portal.resolve(tok.token));
    state.row = row();
    state.tenant = { name: 'T', status: 'suspended', capabilities: { usesRequisiciones: true } };
    const suspended = await fails(portal.resolve(tok.token));
    state.tenant = { name: 'T', status: 'active', capabilities: { usesRequisiciones: false } };
    const noModule = await fails(portal.resolve(tok.token));
    state.tenant = null;
    const noTenant = await fails(portal.resolve(tok.token));
    state.tenant = { name: 'T', status: 'active', capabilities: { usesRequisiciones: true } };
    state.row = row({ estado: 'Aprobada' });
    const notTender = await fails(portal.resolve(tok.token));
    for (const e of [unknown, suspended, noModule, noTenant, notTender]) {
      assert.equal(e.statusCode, 404);
      assert.equal(e.code, 'NOT_FOUND');
      assert.equal(e.message, PORTAL_MENSAJE_NO_ENCONTRADO);
      assert.deepEqual(e.details, unknown.details);
    }
  });

  it('refused, discarded, cancelled and early-expired links are 403 TOKEN_EXPIRADO with a fixed message, and the access is audited as blocked', async () => {
    const cases = [
      row({}, { estadoEnvio: 'Descartado' }),
      row({}, { estadoEnvio: 'Rechazado' }),
      row({ estado: 'Cancelada' }),
      row({}, { tokenVence: PAST }), // closed before the deadline (resend/close/discard) while the deadline is still ahead
    ];
    for (const r of cases) {
      state.row = r; state.views.length = 0;
      const e = await fails(portal.resolve(tok.token, { ip: '9.9.9.9' }));
      assert.equal(e.statusCode, 403);
      assert.equal(e.code, 'TOKEN_EXPIRADO');
      assert.equal(e.message, PORTAL_MENSAJE_TOKEN_EXPIRADO);
      assert.deepEqual(e.details, {});
      const push = state.views[0].update.$push['licitacion.proveedores.$[p].vistas'];
      assert.equal(push.$each[0].bloqueada, true);
      assert.equal(push.$each[0].ip, '9.9.9.9');
      assert.equal(push.$slice, -200);
      assert.equal(state.views[0].options.timestamps, false, 'a view must not bump updatedAt');
    }
  });

  it('a valid access is audited with bloqueada = false; a link whose deadline passed reads as closed, not expired', async () => {
    const ctx = await portal.resolve(tok.token, { ip: '2.2.2.2' });
    assert.equal(ctx.cerrada, false);
    assert.equal(state.views[0].update.$push['licitacion.proveedores.$[p].vistas'].$each[0].bloqueada, false);
    assert.equal(state.views[0].update.$inc['licitacion.proveedores.$[p].vistasCount'], 1);
    state.row = row({ fechaLimiteCotizacion: PAST }, { tokenVence: PAST });
    const late = await portal.resolve(tok.token);
    assert.equal(late.cerrada, true);
    assert.equal(late.vencida, true);
  });

  it('a failing audit write never breaks the request', async () => {
    Requisicion.updateOne = async () => { throw new Error('db down'); };
    const ctx = await portal.resolve(tok.token);
    assert.equal(ctx.cerrada, false);
  });
});

describe('output allowlist', () => {
  it('builds field by field: dirty rows cannot leak prices, internal data or other suppliers', () => {
    const dirty = row({ montoEstimado: 99, precioEstimado: 5, creadaPor: oid(), timeline: [1], areaId: oid(), proveedores: [{ nombre: 'Otro' }], items: [{ descripcion: 'a', cantidad: 1, unidad: 'u', especificacion: 's', precioEstimado: 9 }] },
      { tokenHash: 'h', vistas: [1], correoEnvio: 'x@y.co', cotizacion: { observacion: 'o', valorTotal: 1, origen: 'interno', registradaPor: oid(), archivo: { url: 'https://f/a', nombre: 'a', tipo: 'application/pdf', tamano: 1, storagePath: 'secret' } } });
    const dto = toPortalDto(dirty, dirty.proveedor, { tenantNombre: 'Clinica', cerrada: false });
    assert.deepEqual(Object.keys(dto).sort(), ['cerrada', 'consecutivo', 'cotizacion', 'estadoEnvio', 'fechaLimiteCotizacion', 'instrucciones', 'items', 'tenantNombre', 'titulo']);
    const text = JSON.stringify(dto);
    for (const forbidden of ['montoEstimado', 'precioEstimado', 'creadaPor', 'timeline', 'areaId', 'Otro', 'tokenHash', 'vistas', 'x@y.co', 'origen', 'registradaPor', 'storagePath', 'secret']) assert.ok(!text.includes(forbidden), forbidden);
  });
});

describe('answering', () => {
  it('the public bodies are strict allowlists: internal fields are a 400', () => {
    for (const extra of ['estadoEnvio', 'estado', 'tenantId', 'tokenHash', 'ganadorId', 'origen', 'registradaPor']) {
      assert.ok(portalRespuestaDto.validate({ observacion: 'x', [extra]: 'Ganador' }).error, extra);
      assert.ok(portalRespuestaInvitacionDto.validate({ aceptar: true, [extra]: 'x' }).error, extra);
    }
    assert.ok(portalRespuestaInvitacionDto.validate({ aceptar: 'true' }).error, 'strict boolean');
    assert.equal(portalRespuestaDto.validate({ observacion: 'x', valorTotal: '10.5', tiempoEntregaDias: '3' }).error, undefined);
  });

  it('accepting writes ONE conditional update pinned to the token hash, the state and the deadline, with an external actor', async () => {
    const ctx = await portal.resolve(tok.token);
    state.appendResult = { toObject: () => ({}) };
    state.row = { ...state.row, proveedor: { ...state.row.proveedor, estadoEnvio: 'Aceptado' } };
    await portal.responderInvitacion(ctx, true);
    const { filter, events: rawEvents, extra } = state.writes[0];
    const events = [].concat(rawEvents);
    assert.equal(filter.tenantId, 't1');
    assert.equal(filter.estado, 'En_Licitacion');
    assert.ok(filter['licitacion.fechaLimiteCotizacion'].$gt);
    const em = filter['licitacion.proveedores'].$elemMatch;
    assert.equal(em.tokenHash, hashToken(tok.token));
    assert.equal(em.estadoEnvio, 'Enviado');
    assert.equal(events[0].tipo, 'INVITACION_ACEPTADA');
    assert.equal(events[0].actor.tipo, 'proveedor');
    assert.equal(events[0].actor.nombreExterno, 'Prov SA');
    assert.ok(!JSON.stringify(events).includes(tok.token));
    assert.equal(extra.set['licitacion.proveedores.$[p].estadoEnvio'], 'Aceptado');
  });

  it('only an invited (Enviado) supplier can answer the invitation; a closed or late tender is refused with fixed codes', async () => {
    const ctx = await portal.resolve(tok.token);
    const accepted = { ...ctx, row: { ...ctx.row, proveedor: { ...ctx.row.proveedor, estadoEnvio: 'Aceptado' } } };
    assert.equal((await fails(portal.responderInvitacion(accepted, true))).statusCode, 409);
    const pending = { ...ctx, row: { ...ctx.row, proveedor: { ...ctx.row.proveedor, estadoEnvio: 'Pendiente' } } };
    assert.equal((await fails(portal.enviarCotizacion(pending, { observacion: 'x' }))).statusCode, 409);
    const late = { ...ctx, vencida: true, cerrada: true };
    assert.equal((await fails(portal.responderInvitacion(late, true))).code, 'FECHA_LIMITE_VENCIDA');
    assert.equal((await fails(portal.enviarCotizacion(late, { observacion: 'x' }))).code, 'FECHA_LIMITE_VENCIDA');
    const closed = { ...ctx, row: { ...ctx.row, estado: 'Cotizacion_Recibida' }, cerrada: true };
    assert.equal((await fails(portal.enviarCotizacion(closed, { observacion: 'x' }))).code, 'LICITACION_CERRADA');
    assert.equal(state.writes.length, 0);
  });

  it('an empty or insecure quotation writes nothing; a lost write removes the uploaded file', async () => {
    const ctx = await portal.resolve(tok.token);
    assert.equal((await fails(portal.enviarCotizacion(ctx, {}))).code, 'COTIZACION_VACIA');
    assert.equal((await fails(portal.enviarCotizacion(ctx, { linkPropuesta: 'http://x.co' }))).code, 'LINK_INVALIDO');
    assert.equal(state.writes.length, 0);
    state.appendResult = null; // the guard missed (e.g. closed in the meantime)
    const e = await fails(portal.enviarCotizacion(ctx, { observacion: 'ok' }, { buffer: Buffer.from('%PDF'), originalname: 'a.pdf', mimetype: 'application/pdf' }));
    assert.equal(e.statusCode, 409);
    assert.equal(state.deleted, 'p/a');
  });

  it('a stored quotation is origin portal, never takes the state from the body, and keeps the token out of the history', async () => {
    const ctx = await portal.resolve(tok.token);
    await portal.enviarCotizacion(ctx, { observacion: 'ok', valorTotal: 10, moneda: 'cop', estadoEnvio: 'Ganador' });
    const { filter, events: rawEvents, extra } = state.writes[0];
    const events = [].concat(rawEvents);
    const set = extra.set['licitacion.proveedores.$[p].cotizacion'];
    assert.equal(set.origen, 'portal');
    assert.equal(set.registradaPor, undefined);
    assert.equal(set.estadoEnvio, undefined);
    assert.equal(extra.set['licitacion.proveedores.$[p].estadoEnvio'], 'Aceptado');
    assert.equal(filter['licitacion.proveedores'].$elemMatch.tokenHash, hashToken(tok.token));
    assert.equal(events[0].actor.tipo, 'proveedor');
    assert.ok(!JSON.stringify(events).includes(tok.token));
  });
});
