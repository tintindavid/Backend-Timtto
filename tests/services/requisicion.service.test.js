/**
 * requisiciones-e1-base-aprobacion, tasks 4.2 / 4.3 / 4.4 / 4.6 / 5.4 / 5.5: service level tests (DB-free world).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { requisicionService } from '../../src/services/requisicion.service.js';
import { requisicionApprovalService } from '../../src/services/requisicionApproval.service.js';
import { transition, isTransitionAllowed } from '../../src/services/requisicionTransition.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import {
  REQUISICION_ESTADO,
  REQUISICION_ESTADO_VALUES,
  REQUISICION_TRANSICIONES,
} from '../../src/constants/requisicion.constants.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { createWorld, oid } from '../helpers/requisicionWorld.js';

const T = 'acme';
let w;
let s; // scenario

function scenario() {
  const creator = w.addUser();
  const solicitante = w.addUser();
  const jefeRole = w.addRole([PERMISSIONS.REQUISICIONES_APPROVE]);
  const jefe = w.addUser({ roleId: jefeRole._id });
  const role = w.addRole([PERMISSIONS.REQUISICIONES_APPROVE]);
  const director = w.addUser({ roleId: role._id });
  const otro = w.addUser();
  const area = w.addArea([jefe._id]);
  const tipo = w.addTipo();
  const r1 = w.addRegla({ orden: 1, nombre: 'Jefe', montoDesde: 0, montoHasta: 5000000 });
  const r2 = w.addRegla({ orden: 2, nombre: 'Dirección', montoDesde: 5000000, montoHasta: null, aprobadorTipo: 'rol', rolId: role._id });
  return { creator, solicitante, jefe, role, director, otro, area, tipo, r1, r2 };
}

const payload = (over = {}) => ({
  titulo: 'Compra de guantes',
  tipoRequisicionId: s.tipo._id,
  areaId: s.area._id,
  justificacion: 'Se necesitan',
  lineas: [{ descripcion: 'Guantes', unidad: 'caja', cantidadSolicitada: 2, precioEstimado: 10 }],
  ...over,
});
const big = (monto) => [{ descripcion: 'Equipo', unidad: 'und', cantidadSolicitada: 1, precioEstimado: monto }];
const actor = (u) => ({ userId: u._id, name: 'Fulano' });
const create = (over, user = s.creator, caps) => requisicionService.create(T, user._id, payload(over), caps);
const rejectsWith = async (p, status, code) => assert.rejects(p, (e) => {
  assert.equal(e.statusCode, status, `${e.code}: ${e.message}`);
  if (code) assert.equal(e.code, code);
  return true;
});
/** Approve / reject echoing the CURRENT content version (the approver just loaded the requisition). */
const approveV = (id, a, data = {}) => requisicionApprovalService.approve(T, id, a, { version: row(id)?.version ?? 1, ...data });
const rejectV = (id, a, data = {}) => requisicionApprovalService.reject(T, id, a, { version: row(id)?.version ?? 1, ...data });
const row = (id) => w.requisiciones.find((r) => r._id === String(id));
const snap = (id) => JSON.stringify(row(id));

beforeEach(() => { w = createWorld({ tenantId: T }); s = scenario(); });
afterEach(async () => { await flushRequisicionNotifications(); w.restore(); });

describe('create', () => {
  it('creates a Borrador with consecutivo, creator, requester default, derived amount and CREADA event', async () => {
    const r = await create({ lineas: [{ descripcion: 'A', unidad: 'u', cantidadSolicitada: 3, precioEstimado: 10.5 }] });
    assert.match(r.consecutivo, /^REQ-\d{4}-0001$/);
    assert.equal(r.estado, REQUISICION_ESTADO.BORRADOR);
    assert.equal(String(r.creadaPor), s.creator._id);
    assert.equal(String(r.solicitanteId), s.creator._id);
    assert.equal(r.montoEstimado, 31.5);
    assert.equal(r.moneda, 'COP');
    assert.deepEqual(r.timeline.map((e) => e.tipo), ['CREADA']);
    assert.equal(r.isDeleted, undefined);
  });

  it('parallel creations get distinct, consecutive numbers', async () => {
    const out = await Promise.all([1, 2, 3, 4, 5].map(() => create()));
    const nums = out.map((r) => Number(r.consecutivo.split('-')[2])).sort((a, b) => a - b);
    assert.deepEqual(nums, [1, 2, 3, 4, 5]);
  });

  it('no lines -> 400 SIN_LINEAS and nothing is stored', async () => {
    await rejectsWith(create({ lineas: [] }), 400, 'SIN_LINEAS');
    assert.equal(w.requisiciones.length, 0);
  });

  it('stock item without usesInventoryBasic -> 403 CAPABILITY_DISABLED', async () => {
    const item = w.addItem();
    const lineas = [{ inventarioItemId: item._id, cantidadSolicitada: 1 }];
    await rejectsWith(create({ lineas }, s.creator, { usesInventoryBasic: false }), 403, 'CAPABILITY_DISABLED');
    assert.equal(w.requisiciones.length, 0);
  });

  it('stock item with the capability: price and snapshot autocomplete from the item', async () => {
    const item = w.addItem({ precio: 12.5 });
    const r = await create({ lineas: [{ inventarioItemId: item._id, cantidadSolicitada: 4 }] }, s.creator, { usesInventoryBasic: true });
    assert.equal(r.lineas[0].precioEstimado, 12.5);
    assert.equal(r.lineas[0].descripcion, 'Guante');
    assert.equal(r.lineas[0].snapshot.precio, 12.5);
    assert.equal(r.montoEstimado, 50);
  });

  it('same item twice -> 409 LINEA_DUPLICADA; item of another tenant -> 400', async () => {
    const item = w.addItem();
    const caps = { usesInventoryBasic: true };
    await rejectsWith(create({ lineas: [{ inventarioItemId: item._id, cantidadSolicitada: 1 }, { inventarioItemId: item._id, cantidadSolicitada: 2 }] }, s.creator, caps), 409, 'LINEA_DUPLICADA');
    const foreign = w.addItem({ tenantId: 'other' });
    await rejectsWith(create({ lineas: [{ inventarioItemId: foreign._id, cantidadSolicitada: 1 }] }, s.creator, caps), 400, 'ITEM_INVALIDO');
  });

  it('inactive/foreign type or area -> 400', async () => {
    await rejectsWith(create({ tipoRequisicionId: oid() }), 400, 'TIPO_INVALIDO');
    await rejectsWith(create({ areaId: oid() }), 400, 'AREA_INVALIDA');
  });
});

describe('update / delete / IDOR', () => {
  it('edits in Borrador, recomputes the amount and keeps the stock snapshot', async () => {
    const item = w.addItem({ precio: 10 });
    const r = await create({ lineas: [{ inventarioItemId: item._id, cantidadSolicitada: 1 }] }, s.creator, { usesInventoryBasic: true });
    item.precio = 99; // the item changes afterwards
    const u = await requisicionService.update(T, s.creator._id, r._id, {
      lineas: [{ lineaId: r.lineas[0].lineaId, inventarioItemId: item._id, cantidadSolicitada: 3 }],
    }, { usesInventoryBasic: true });
    assert.equal(u.lineas[0].snapshot.precio, 10);
    assert.equal(u.lineas[0].precioEstimado, 10);
    assert.equal(u.montoEstimado, 30);
    assert.equal(u.timeline.at(-1).tipo, 'EDITADA');
  });

  it('tipo is immutable (400 TIPO_INMUTABLE) and non-editable states are 409 ESTADO_NO_EDITABLE', async () => {
    const r = await create();
    await rejectsWith(requisicionService.update(T, s.creator._id, r._id, { tipoRequisicionId: oid() }), 400, 'TIPO_INMUTABLE');
    for (const estado of REQUISICION_ESTADO_VALUES.filter((e) => e !== 'Borrador')) {
      const d = w.seedRequisicion({ estado });
      const before = snap(d._id);
      await rejectsWith(requisicionService.update(T, s.creator._id, d._id, { titulo: 'x' }), 409, 'ESTADO_NO_EDITABLE');
      assert.equal(snap(d._id), before);
    }
  });

  it('soft delete only in Borrador', async () => {
    const r = await create();
    await requisicionService.delete(T, r._id, actor(s.creator));
    assert.equal(row(r._id).isDeleted, true);
    await rejectsWith(requisicionService.getById(T, r._id), 404);
    const d = w.seedRequisicion({ estado: 'En_Aprobacion' });
    await rejectsWith(requisicionService.delete(T, d._id, actor(s.creator)), 409, 'ESTADO_NO_EDITABLE');
  });

  it('another tenant gets 404 on every operation (IDOR)', async () => {
    const foreign = w.seedRequisicion({ tenantId: 'other', estado: 'En_Aprobacion',
      aprobacion: { nivelActual: 1, niveles: [{ orden: 1, estado: 'Pendiente', aprobadorTipo: 'usuarios', aprobadorIds: [s.jefe._id] }] } });
    const id = foreign._id;
    await rejectsWith(requisicionService.getById(T, id), 404);
    await rejectsWith(requisicionService.update(T, s.creator._id, id, { titulo: 'x' }), 404);
    await rejectsWith(requisicionService.delete(T, id, actor(s.creator)), 404);
    await rejectsWith(requisicionService.enviar(T, id, actor(s.creator)), 404);
    await rejectsWith(requisicionService.cancelar(T, id, actor(s.creator), { motivo: 'x' }), 404);
    await rejectsWith(requisicionService.cambiarEstado(T, id, actor(s.creator), { estado: 'Borrador' }), 404);
    await rejectsWith(approveV(id, actor(s.jefe)), 404);
    await rejectsWith(rejectV(id, actor(s.jefe), { observacion: 'no' }), 404);
    assert.equal(row(id).estado, 'En_Aprobacion');
  });
});

describe('list', () => {
  it('always filters by tenant, escapes the search and paginates', async () => {
    await create();
    w.seedRequisicion({ tenantId: 'other' });
    const out = await requisicionService.list(T, s.creator._id, { search: '.*(' }, { page: 1, limit: 5 });
    assert.equal(w.lastFind.tenantId, T);
    const rx = w.lastFind.$and[0].$or[0].consecutivo;
    assert.equal(rx.source, '\\.\\*\\(');
    assert.equal(out.data.length, 0);
    const all = await requisicionService.list(T, s.creator._id, {}, { page: 1, limit: 5 });
    assert.equal(all.pagination.total, 1);
    assert.equal(all.data.every((d) => d.tenantId === T), true);
  });

  it('vista mias and por-aprobar build the expected filters', async () => {
    await requisicionService.list(T, s.creator._id, { vista: 'mias' }, { page: 1, limit: 5 });
    assert.equal(w.lastFind.$and[0].$or.length, 2);
    await requisicionService.list(T, s.jefe._id, { vista: 'por-aprobar' }, { page: 1, limit: 5 });
    const clauses = w.lastFind.$and;
    assert.ok(clauses.some((c) => c.estado === 'En_Aprobacion'));
    assert.ok(clauses.some((c) => c.$expr));
    assert.ok(clauses.some((c) => c.creadaPor?.$ne) && clauses.some((c) => c.solicitanteId?.$ne));
  });
});

describe('transition table (every invalid pair is a 409 without mutation)', () => {
  for (const from of REQUISICION_ESTADO_VALUES) {
    for (const to of REQUISICION_ESTADO_VALUES) {
      const allowed = REQUISICION_TRANSICIONES[from].includes(to);
      it(`${from} -> ${to} is ${allowed ? 'allowed' : '409 TRANSICION_INVALIDA'}`, async () => {
        assert.equal(isTransitionAllowed(from, to), allowed);
        const d = w.seedRequisicion({ estado: from });
        const before = snap(d._id);
        const run = transition(T, d._id, { from, to, events: [{ tipo: 'EDITADA', eventId: oid(), fecha: new Date(), actor: { tipo: 'sistema' } }] });
        if (allowed) {
          const out = await run;
          assert.equal(out.estado, to);
        } else {
          await rejectsWith(run, 409, 'TRANSICION_INVALIDA');
          assert.equal(snap(d._id), before);
        }
      });
    }
  }

  it('a stale "from" (document moved on) is 409 and does not write', async () => {
    const d = w.seedRequisicion({ estado: 'Rechazada' });
    await rejectsWith(transition(T, d._id, { from: 'Borrador', to: 'Enviada', events: [{ tipo: 'ENVIADA', eventId: oid(), fecha: new Date(), actor: { tipo: 'sistema' } }] }), 409, 'TRANSICION_INVALIDA');
    assert.equal(row(d._id).estado, 'Rechazada');
    assert.equal(w.writes.count, 0);
  });

  it('operations out of their state are 409 with no mutation', async () => {
    const ops = {
      enviar: (id) => requisicionService.enviar(T, id, actor(s.creator)),
      retirar: (id) => requisicionService.cambiarEstado(T, id, actor(s.creator), { estado: 'Borrador', observacion: 'x' }),
      aprobar: (id) => approveV(id, actor(s.jefe)),
      rechazar: (id) => rejectV(id, actor(s.jefe), { observacion: 'no' }),
      cancelar: (id) => requisicionService.cancelar(T, id, actor(s.creator), { motivo: 'x' }),
    };
    const valid = { enviar: ['Borrador'], retirar: ['En_Aprobacion', 'Rechazada'], aprobar: ['En_Aprobacion'], rechazar: ['En_Aprobacion'], cancelar: ['Borrador', 'Enviada', 'En_Aprobacion', 'Aprobada', 'En_Recepcion', 'Rechazada'] };
    for (const [name, fn] of Object.entries(ops)) {
      for (const estado of REQUISICION_ESTADO_VALUES.filter((e) => !valid[name].includes(e))) {
        const d = w.seedRequisicion({ estado, creadaPor: s.creator._id, solicitanteId: s.creator._id });
        const before = snap(d._id);
        await rejectsWith(fn(d._id), 409, 'TRANSICION_INVALIDA');
        assert.equal(snap(d._id), before, `${name} from ${estado} mutated`);
      }
    }
  });
});

describe('enviar', () => {
  it('Borrador -> En_Aprobacion in ONE write with ENVIADA + APROBACION_SOLICITADA and frozen levels', async () => {
    const r = await create({ lineas: big(7000000) });
    const writesBefore = w.writes.count;
    const out = await requisicionService.enviar(T, r._id, actor(s.creator));
    assert.equal(w.writes.count - writesBefore, 1);
    assert.equal(out.estado, 'En_Aprobacion');
    assert.deepEqual(out.timeline.map((e) => e.tipo), ['CREADA', 'ENVIADA', 'APROBACION_SOLICITADA']);
    assert.deepEqual(out.aprobacion.niveles.map((n) => n.orden), [1, 2]);
    assert.equal(out.aprobacion.nivelActual, 1);
    assert.ok(out.enviadaAt);
  });

  it('resolution is cumulative: 7M needs both levels, 1M only the first; later rule edits do not touch it', async () => {
    const low = await requisicionService.enviar(T, (await create({ lineas: big(1000000) }))._id, actor(s.creator));
    assert.equal(low.aprobacion.niveles.length, 1);
    const high = await requisicionService.enviar(T, (await create({ lineas: big(7000000) }))._id, actor(s.creator));
    s.r2.montoDesde = 9000000;
    s.r1.nombre = 'Cambiado';
    assert.equal(row(high._id).aprobacion.niveles.length, 2);
    assert.equal(row(high._id).aprobacion.niveles[0].nombre, 'Jefe');
  });

  it('no active rules -> 422 SIN_REGLAS_APROBACION; level without eligible approver -> 422; state unchanged', async () => {
    const r = await create();
    w.reglas.forEach((x) => { x.activo = false; });
    let before = snap(r._id);
    await rejectsWith(requisicionService.enviar(T, r._id, actor(s.creator)), 422, 'SIN_REGLAS_APROBACION');
    assert.equal(snap(r._id), before);
    w.reglas.forEach((x) => { x.activo = true; });
    s.r1.aprobadorTipo = 'usuarios';
    s.r1.usuariosIds = [s.creator._id]; // the only approver is the creator
    before = snap(r._id);
    await rejectsWith(requisicionService.enviar(T, r._id, actor(s.creator)), 422, 'NIVEL_SIN_APROBADOR_ELEGIBLE');
    assert.equal(snap(r._id), before);
  });

  it('requires lines and justification; only the creator/requester sends', async () => {
    const noLines = w.seedRequisicion({ lineas: [], creadaPor: s.creator._id, solicitanteId: s.creator._id });
    await rejectsWith(requisicionService.enviar(T, noLines._id, actor(s.creator)), 400, 'SIN_LINEAS');
    const noJust = await create({ justificacion: undefined });
    await rejectsWith(requisicionService.enviar(T, noJust._id, actor(s.creator)), 400, 'JUSTIFICACION_REQUERIDA');
    const ok = await requisicionService.enviar(T, noJust._id, actor(s.creator), { justificacion: 'Porque sí' });
    assert.equal(ok.justificacion, 'Porque sí');
    const mine = await create();
    await rejectsWith(requisicionService.enviar(T, mine._id, actor(s.otro)), 403, 'SOLO_CREADOR');
  });
});

describe('approval flow and separation of duties', () => {
  async function sent(monto = 7000000) {
    const r = await create({ lineas: big(monto), solicitanteId: s.solicitante._id });
    return requisicionService.enviar(T, r._id, actor(s.creator));
  }

  it('full cycle: timeline order, level advance and Aprobada with aprobadaAt', async () => {
    const r = await sent();
    const mid = await approveV(r._id, actor(s.jefe), { observacion: 'ok' });
    assert.equal(mid.estado, 'En_Aprobacion');
    assert.equal(mid.aprobacion.nivelActual, 2);
    const done = await approveV(r._id, actor(s.director));
    assert.equal(done.estado, 'Aprobada');
    assert.ok(done.aprobadaAt);
    assert.equal(done.aprobacion.nivelActual, null);
    assert.deepEqual(done.timeline.map((e) => e.tipo), ['CREADA', 'ENVIADA', 'APROBACION_SOLICITADA', 'NIVEL_APROBADO', 'NIVEL_APROBADO', 'APROBADA']);
  });

  it('creator and requester cannot approve their own requisition (403 SEPARACION_FUNCIONES)', async () => {
    const r = await sent(1000000);
    for (const u of [s.creator, s.solicitante]) {
      await rejectsWith(approveV(r._id, actor(u)), 403, 'SEPARACION_FUNCIONES');
    }
    assert.equal(row(r._id).estado, 'En_Aprobacion');
  });

  it('who approved level 1 cannot approve level 2 even if eligible for it', async () => {
    s.r2.aprobadorTipo = 'usuarios';
    s.r2.rolId = null;
    s.r2.usuariosIds = [s.jefe._id, s.director._id];
    const r = await sent();
    await approveV(r._id, actor(s.jefe));
    await rejectsWith(approveV(r._id, actor(s.jefe)), 403, 'SEPARACION_FUNCIONES');
    assert.equal(row(r._id).aprobacion.nivelActual, 2);
  });

  it('user outside the current level -> 403; role eligibility is checked live', async () => {
    const r = await sent();
    await rejectsWith(approveV(r._id, actor(s.otro)), 403, 'APROBADOR_NO_ELEGIBLE');
    await approveV(r._id, actor(s.jefe));
    // director is eligible by role; when the role loses the permission the decision is denied
    s.role.permissions = [];
    await rejectsWith(approveV(r._id, actor(s.director)), 403, 'APROBADOR_NO_ELEGIBLE');
    s.role.permissions = [PERMISSIONS.REQUISICIONES_APPROVE];
    s.director.roleId = oid();
    await rejectsWith(approveV(r._id, actor(s.director)), 403, 'APROBADOR_NO_ELEGIBLE');
  });

  it('jefe_area resolves to the heads of the REQUISITION area', async () => {
    const otherJefe = w.addUser({ roleId: s.jefe.roleId });
    const otherArea = w.addArea([otherJefe._id], { codigo: 'OTRA', nombre: 'Otra' });
    const r = await create({ areaId: otherArea._id, lineas: big(1000000) });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    await rejectsWith(approveV(r._id, actor(s.jefe)), 403, 'APROBADOR_NO_ELEGIBLE');
    const done = await approveV(r._id, actor(otherJefe));
    assert.equal(done.estado, 'Aprobada');
  });

  it('parallel approvals of the same level: exactly one applies, the other is 409', async () => {
    const second = w.addUser({ roleId: s.jefe.roleId });
    s.area.jefesIds.push(second._id);
    const r = await sent(1000000);
    const res = await Promise.allSettled([
      approveV(r._id, actor(s.jefe)),
      approveV(r._id, actor(second)),
    ]);
    assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
    const failed = res.find((x) => x.status === 'rejected');
    assert.equal(failed.reason.statusCode, 409);
    assert.equal(row(r._id).timeline.filter((e) => e.tipo === 'NIVEL_APROBADO').length, 1);
  });

  it('reject needs an observation (400), then cancels the remaining levels', async () => {
    const r = await sent();
    const before = snap(r._id);
    await rejectsWith(rejectV(r._id, actor(s.jefe), { observacion: '  ' }), 400, 'OBSERVACION_REQUERIDA');
    assert.equal(snap(r._id), before);
    const out = await rejectV(r._id, actor(s.jefe), { observacion: 'Muy caro' });
    assert.equal(out.estado, 'Rechazada');
    assert.deepEqual(out.aprobacion.niveles.map((n) => n.estado), ['Rechazado', 'Cancelado']);
    assert.deepEqual(out.timeline.slice(-2).map((e) => e.tipo), ['NIVEL_RECHAZADO', 'RECHAZADA']);
    assert.ok(out.rechazadaAt);
  });
});

describe('retirar / reabrir / cancelar', () => {
  it('retire returns to Borrador with cancelled levels; reopen after a rejection', async () => {
    const r = await create({ lineas: big(1000000) });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    await rejectsWith(requisicionService.cambiarEstado(T, r._id, actor(s.creator), { estado: 'Borrador' }), 400, 'OBSERVACION_REQUERIDA');
    const w1 = await requisicionService.cambiarEstado(T, r._id, actor(s.creator), { estado: 'Borrador', observacion: 'corregir' });
    assert.equal(w1.estado, 'Borrador');
    assert.equal(w1.aprobacion.niveles[0].estado, 'Cancelado');
    assert.equal(w1.timeline.at(-1).tipo, 'RETIRADA');

    await requisicionService.enviar(T, r._id, actor(s.creator));
    await rejectV(r._id, actor(s.jefe), { observacion: 'no' });
    const re = await requisicionService.cambiarEstado(T, r._id, actor(s.creator), { estado: 'Borrador' });
    assert.equal(re.estado, 'Borrador');
    assert.equal(re.timeline.at(-1).tipo, 'REABIERTA');
    await rejectsWith(requisicionService.cambiarEstado(T, r._id, actor(s.creator), { estado: 'Borrador' }), 409, 'TRANSICION_INVALIDA');
  });

  it('cancel works from every non-terminal state (incl. Aprobada), needs a motivo and is final', async () => {
    for (const estado of ['Borrador', 'Enviada', 'En_Aprobacion', 'Aprobada', 'Rechazada']) {
      const d = w.seedRequisicion({ estado, aprobacion: { nivelActual: estado === 'En_Aprobacion' ? 1 : null, niveles: estado === 'En_Aprobacion' ? [{ orden: 1, estado: 'Pendiente', aprobadorTipo: 'usuarios', aprobadorIds: [s.jefe._id] }] : [] } });
      await rejectsWith(requisicionService.cancelar(T, d._id, actor(s.otro), { motivo: ' ' }), 400, 'MOTIVO_REQUERIDO');
      const out = await requisicionService.cancelar(T, d._id, actor(s.otro), { motivo: 'Ya no se necesita' });
      assert.equal(out.estado, 'Cancelada');
      assert.equal(String(out.canceladaPor), s.otro._id);
      assert.ok(out.canceladaAt);
      assert.equal(out.timeline.at(-1).tipo, 'CANCELADA');
      if (estado === 'En_Aprobacion') assert.equal(out.aprobacion.niveles[0].estado, 'Cancelado');
      await rejectsWith(requisicionService.cancelar(T, d._id, actor(s.otro), { motivo: 'otra vez' }), 409, 'TRANSICION_INVALIDA');
    }
  });
});

describe('notifications (5.4 / 5.5)', () => {
  const eventsOf = () => w.emits.map((e) => e.event);

  it('submit fires submitted + approval.requested with ALL recipients through extraRecipientUserIds', async () => {
    const r = await create({ lineas: big(1000000), solicitanteId: s.solicitante._id });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    await flushRequisicionNotifications();
    assert.deepEqual(eventsOf().sort(), ['requisicion.approval.requested', 'requisicion.submitted']);
    const req = w.emits.find((e) => e.event === 'requisicion.approval.requested');
    assert.deepEqual(req.options.extraRecipientUserIds, [s.jefe._id]);
    assert.deepEqual(req.options.excludeRecipientUserIds, [s.creator._id]);
    assert.equal(req.payload.data.link, `/requisiciones/${r._id}`);
    const sub = w.emits.find((e) => e.event === 'requisicion.submitted');
    assert.deepEqual([...sub.options.extraRecipientUserIds].sort(), [s.creator._id, s.solicitante._id, s.jefe._id].sort());
  });

  it('level approval notifies the creator and the next level approvers; final approval and rejection the creator', async () => {
    const r = await create({ lineas: big(7000000) });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    await flushRequisicionNotifications();
    w.emits.length = 0;
    await approveV(r._id, actor(s.jefe));
    await flushRequisicionNotifications();
    assert.deepEqual(eventsOf().sort(), ['requisicion.approval.requested', 'requisicion.level.approved']);
    assert.deepEqual(w.emits.find((e) => e.event === 'requisicion.approval.requested').options.extraRecipientUserIds, [s.director._id]);
    w.emits.length = 0;
    await approveV(r._id, actor(s.director));
    await flushRequisicionNotifications();
    assert.deepEqual(eventsOf(), ['requisicion.approved']);
    assert.ok(w.emits[0].options.extraRecipientUserIds.includes(s.creator._id));
  });

  it('rejected / withdrawn / cancelled events are emitted', async () => {
    const a = await create({ lineas: big(1000000) });
    await requisicionService.enviar(T, a._id, actor(s.creator));
    await rejectV(a._id, actor(s.jefe), { observacion: 'no' });
    const b = await create({ lineas: big(1000000) });
    await requisicionService.enviar(T, b._id, actor(s.creator));
    await requisicionService.cambiarEstado(T, b._id, actor(s.creator), { estado: 'Borrador', observacion: 'x' });
    await requisicionService.cancelar(T, b._id, actor(s.creator), { motivo: 'm' });
    await flushRequisicionNotifications();
    for (const ev of ['requisicion.rejected', 'requisicion.withdrawn', 'requisicion.cancelled']) assert.ok(eventsOf().includes(ev), ev);
  });

  it('a failing notification never breaks or rolls back the transition', async () => {
    w.restore();
    w = createWorld({ tenantId: T, failEmit: true });
    s = scenario();
    const r = await create({ lineas: big(1000000) });
    const out = await requisicionService.enviar(T, r._id, actor(s.creator));
    assert.equal(out.estado, 'En_Aprobacion');
    const done = await approveV(r._id, actor(s.jefe));
    await flushRequisicionNotifications();
    assert.equal(done.estado, 'Aprobada');
    assert.ok(w.emits.length >= 2);
  });
});
