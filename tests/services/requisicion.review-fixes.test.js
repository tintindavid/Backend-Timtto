/**
 * requisiciones-e1-base-aprobacion, adversarial review fixes (DB-free world): owner rules (M1), distinct approvers
 * and reassignment (M2), content version (M3), vista por-aprobar AND filter, delete audit.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { requisicionService } from '../../src/services/requisicion.service.js';
import { requisicionApprovalService } from '../../src/services/requisicionApproval.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { findDistinctAssignment } from '../../src/utils/approverAssignment.util.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { createWorld } from '../helpers/requisicionWorld.js';

const T = 'acme';
let w;
let s;

function scenario() {
  const creator = w.addUser();
  const solicitante = w.addUser();
  const intruso = w.addUser();
  const jefeRole = w.addRole([PERMISSIONS.REQUISICIONES_APPROVE]);
  const jefe = w.addUser({ roleId: jefeRole._id });
  const role = w.addRole([PERMISSIONS.REQUISICIONES_APPROVE]);
  const director = w.addUser({ roleId: role._id });
  const area = w.addArea([jefe._id]);
  const tipo = w.addTipo();
  w.addRegla({ orden: 1, nombre: 'Jefe', montoDesde: 0, montoHasta: 5000000 });
  w.addRegla({ orden: 2, nombre: 'Dirección', montoDesde: 5000000, montoHasta: null, aprobadorTipo: 'rol', rolId: role._id });
  return { creator, solicitante, intruso, jefe, jefeRole, director, role, area, tipo };
}

const big = (monto) => [{ descripcion: 'Equipo', unidad: 'und', cantidadSolicitada: 1, precioEstimado: monto }];
const create = (over = {}, user = s.creator) => requisicionService.create(T, user._id, {
  titulo: 'Compra', tipoRequisicionId: s.tipo._id, areaId: s.area._id, justificacion: 'Se necesita', lineas: big(100), ...over,
});
const actor = (u, extra = {}) => ({ userId: u._id, name: 'X', ...extra });
const row = (id) => w.requisiciones.find((r) => r._id === String(id));
const approveV = (id, a, data = {}) => requisicionApprovalService.approve(T, id, a, { version: row(id).version, ...data });
const rejectsWith = async (p, status, code) => assert.rejects(p, (e) => {
  assert.equal(e.statusCode, status, `${e.code}: ${e.message}`);
  if (code) assert.equal(e.code, code);
  return true;
});

beforeEach(() => { w = createWorld({ tenantId: T }); s = scenario(); });
afterEach(async () => { await flushRequisicionNotifications(); w.restore(); });

describe('M1 owner rules on a Borrador', () => {
  it('a third party cannot edit, delete, send or change the requester (403 SOLO_CREADOR); nothing changes', async () => {
    const r = await create();
    const before = JSON.stringify(row(r._id));
    await rejectsWith(requisicionService.update(T, s.intruso._id, r._id, { titulo: 'x' }), 403, 'SOLO_CREADOR');
    await rejectsWith(requisicionService.update(T, s.intruso._id, r._id, { solicitanteId: s.intruso._id }), 403, 'SOLO_CREADOR');
    await rejectsWith(requisicionService.delete(T, r._id, actor(s.intruso)), 403, 'SOLO_CREADOR');
    await rejectsWith(requisicionService.enviar(T, r._id, actor(s.intruso)), 403, 'SOLO_CREADOR');
    assert.equal(JSON.stringify(row(r._id)), before);
  });

  it('the requester may edit but only the creator may change the requester', async () => {
    const r = await create({ solicitanteId: s.solicitante._id });
    const ok = await requisicionService.update(T, s.solicitante._id, r._id, { titulo: 'Nuevo' });
    assert.equal(ok.titulo, 'Nuevo');
    await rejectsWith(requisicionService.update(T, s.solicitante._id, r._id, { solicitanteId: s.intruso._id }), 403, 'SOLO_CREADOR');
    const swapped = await requisicionService.update(T, s.creator._id, r._id, { solicitanteId: s.intruso._id });
    assert.equal(String(swapped.solicitanteId), String(s.intruso._id));
  });

  it('requisiciones:manage-all lets a supervisor intervene on any draft; the retire and reopen are owner-only too', async () => {
    const r = await create();
    const edited = await requisicionService.update(T, s.intruso._id, r._id, { titulo: 'Sup' }, undefined, { canManageAll: true });
    assert.equal(edited.titulo, 'Sup');
    const sent = await requisicionService.enviar(T, r._id, actor(s.intruso, { canManageAll: true }));
    assert.equal(sent.estado, 'En_Aprobacion');
    await rejectsWith(requisicionService.cambiarEstado(T, r._id, actor(s.intruso), { estado: 'Borrador', observacion: 'x' }), 403, 'SOLO_CREADOR');
    const back = await requisicionService.cambiarEstado(T, r._id, actor(s.intruso, { canManageAll: true }), { estado: 'Borrador', observacion: 'x' });
    assert.equal(back.estado, 'Borrador');
    await requisicionService.delete(T, r._id, actor(s.intruso, { canManageAll: true }));
  });

  it('delete keeps an ELIMINADA entry in the timeline of the (soft deleted) document', async () => {
    const r = await create();
    await requisicionService.delete(T, r._id, actor(s.creator));
    const raw = row(r._id);
    assert.equal(raw.isDeleted, true);
    assert.equal(raw.timeline.at(-1).tipo, 'ELIMINADA');
  });
});

describe('M3 content version', () => {
  it('starts at 1 and is bumped by edit, send, retire and reopen; it is in the response', async () => {
    const r = await create();
    assert.equal(r.version, 1);
    assert.equal((await requisicionService.update(T, s.creator._id, r._id, { titulo: 'v2' })).version, 2);
    assert.equal((await requisicionService.enviar(T, r._id, actor(s.creator))).version, 3);
    assert.equal((await requisicionService.cambiarEstado(T, r._id, actor(s.creator), { estado: 'Borrador', observacion: 'x' })).version, 4);
  });

  it('approve / reject with a stale version -> 409 VERSION_DESACTUALIZADA and NO mutation', async () => {
    const r = await create({ lineas: big(1000) });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    const seen = row(r._id).version;
    // The owner retires, edits and re-sends: same nivelActual, different content.
    await requisicionService.cambiarEstado(T, r._id, actor(s.creator), { estado: 'Borrador', observacion: 'cambio' });
    await requisicionService.update(T, s.creator._id, r._id, { lineas: big(9000) });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    const before = JSON.stringify(row(r._id));
    await rejectsWith(requisicionApprovalService.approve(T, r._id, actor(s.jefe), { version: seen }), 409, 'VERSION_DESACTUALIZADA');
    await rejectsWith(requisicionApprovalService.reject(T, r._id, actor(s.jefe), { version: seen, observacion: 'no' }), 409, 'VERSION_DESACTUALIZADA');
    assert.equal(JSON.stringify(row(r._id)), before);
    const ok = await approveV(r._id, actor(s.jefe));
    assert.equal(ok.version, row(r._id).version);
  });
});

describe('M2 distinct eligible approvers', () => {
  it('pure matching: one person as the only option of two levels is infeasible and both levels are reported', () => {
    const res = findDistinctAssignment([{ key: 1, ids: ['a'] }, { key: 2, ids: ['a'] }, { key: 3, ids: ['b', 'c'] }]);
    assert.equal(res.feasible, false);
    assert.deepEqual(res.offending, [1, 2]);
    assert.equal(findDistinctAssignment([{ key: 1, ids: ['a'] }, { key: 2, ids: ['a', 'b'] }]).feasible, true);
    assert.deepEqual(findDistinctAssignment([{ key: 1, ids: [] }]).offending, [1]);
  });

  it('send -> 422 NIVEL_SIN_APROBADOR_ELEGIBLE when one person is the only approver of two levels (nothing changes)', async () => {
    s.director.roleId = null; // L2 role has no members
    s.jefe.roleId = s.role._id; // the head is now the only member of the L2 role
    const r = await create({ lineas: big(7000000) });
    const before = JSON.stringify(row(r._id));
    const err = await requisicionService.enviar(T, r._id, actor(s.creator)).then(() => null, (e) => e);
    assert.equal(err.statusCode, 422);
    assert.equal(err.code, 'NIVEL_SIN_APROBADOR_ELEGIBLE');
    assert.deepEqual(err.details.niveles.map((n) => n.orden), [1, 2]);
    assert.equal(JSON.stringify(row(r._id)), before);
  });

  it('a head whose role lacks requisiciones:approve is not eligible (422)', async () => {
    s.jefe.roleId = null;
    const r = await create({ lineas: big(1000) });
    await rejectsWith(requisicionService.enviar(T, r._id, actor(s.creator)), 422, 'NIVEL_SIN_APROBADOR_ELEGIBLE');
  });
});

describe('M2 reasignar aprobadores', () => {
  async function pending() {
    const r = await create({ lineas: big(7000000) });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    return r;
  }

  it('replaces the approvers of the current level, logs APROBADORES_REASIGNADOS and notifies the new approvers', async () => {
    const nuevo = w.addUser({ roleId: s.jefeRole._id });
    const r = await pending();
    w.emits.length = 0;
    const out = await requisicionApprovalService.reassign(T, r._id, actor(s.director, { canManageAll: true }), { nivelOrden: 1, aprobadorIds: [nuevo._id] });
    assert.deepEqual(row(r._id).aprobacion.niveles[0].aprobadorIds, [nuevo._id]);
    assert.equal(out.timeline.at(-1).tipo, 'APROBADORES_REASIGNADOS');
    assert.equal(out.version, row(r._id).version);
    await flushRequisicionNotifications();
    const ev = w.emits.find((e) => e.event === 'requisicion.approval.requested');
    assert.deepEqual(ev.options.extraRecipientUserIds, [nuevo._id]);
    // The old head can no longer decide; the new one can.
    await assert.rejects(approveV(r._id, actor(s.jefe)), { code: 'APROBADOR_NO_ELEGIBLE' });
    const mid = await approveV(r._id, actor(nuevo));
    assert.equal(mid.aprobacion.nivelActual, 2);
  });

  it('rejects creator/requester, users without the approve permission and users that already decided', async () => {
    const r = await pending();
    const sinPermiso = w.addUser();
    await rejectsWith(requisicionApprovalService.reassign(T, r._id, actor(s.director), { nivelOrden: 1, aprobadorIds: [s.creator._id] }), 400, 'SEPARACION_FUNCIONES');
    await rejectsWith(requisicionApprovalService.reassign(T, r._id, actor(s.director), { nivelOrden: 1, aprobadorIds: [sinPermiso._id] }), 400, 'APROBADOR_NO_ELEGIBLE');
    await approveV(r._id, actor(s.jefe));
    // L1 is decided now: only pending levels can be reassigned; and the decider cannot take L2.
    await rejectsWith(requisicionApprovalService.reassign(T, r._id, actor(s.director), { nivelOrden: 1, aprobadorIds: [s.director._id] }), 409, 'NIVEL_NO_PENDIENTE');
    await rejectsWith(requisicionApprovalService.reassign(T, r._id, actor(s.director), { nivelOrden: 2, aprobadorIds: [s.jefe._id] }), 400, 'SEPARACION_FUNCIONES');
  });

  it('would leave another pending level without a distinct approver -> 422; only En_Aprobacion requisitions', async () => {
    const r = await pending();
    // The director is the only member of the L2 role: moving him to L1 starves L2.
    await rejectsWith(requisicionApprovalService.reassign(T, r._id, actor(s.jefe), { nivelOrden: 1, aprobadorIds: [s.director._id] }), 422, 'NIVEL_SIN_APROBADOR_ELEGIBLE');
    const draft = await create();
    await rejectsWith(requisicionApprovalService.reassign(T, draft._id, actor(s.jefe), { nivelOrden: 1, aprobadorIds: [s.jefe._id] }), 409, 'TRANSICION_INVALIDA');
  });

  it('a rol level becomes an explicit usuarios level (the role members stop being eligible)', async () => {
    const nuevo = w.addUser({ roleId: s.jefeRole._id });
    const r = await pending();
    await approveV(r._id, actor(s.jefe));
    await requisicionApprovalService.reassign(T, r._id, actor(s.jefe, { canManageAll: true }), { nivelOrden: 2, aprobadorIds: [nuevo._id] });
    const l2 = row(r._id).aprobacion.niveles[1];
    assert.equal(l2.aprobadorTipo, 'usuarios');
    assert.equal(l2.rolId, null);
    await assert.rejects(approveV(r._id, actor(s.director)), { code: 'APROBADOR_NO_ELEGIBLE' });
    assert.equal((await approveV(r._id, actor(nuevo))).estado, 'Aprobada');
  });
});

describe('N1 approve-time anti-deadlock guard (overlapping eligible sets)', () => {
  // L1 jefe_area (heads A, B) and L2 usuarios [A]: the send is feasible (B for L1, A for L2) but A approving L1 would
  // leave L2 with nobody.
  function overlap() {
    w.restore();
    w = createWorld({ tenantId: T });
    const role = w.addRole([PERMISSIONS.REQUISICIONES_APPROVE]);
    const A = w.addUser({ roleId: role._id });
    const B = w.addUser({ roleId: role._id });
    const C = w.addUser({ roleId: role._id });
    const creator = w.addUser();
    const area = w.addArea([A._id, B._id]);
    const tipo = w.addTipo();
    w.addRegla({ orden: 1, nombre: 'Jefe', montoDesde: 0 });
    w.addRegla({ orden: 2, nombre: 'Comité', montoDesde: 1000, aprobadorTipo: 'usuarios', usuariosIds: [A._id] });
    s = { creator, A, B, C, area, tipo };
  }
  const sent = async () => {
    const r = await requisicionService.create(T, s.creator._id, {
      titulo: 'Compra', tipoRequisicionId: s.tipo._id, areaId: s.area._id, justificacion: 'x', lineas: big(5000),
    });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    return r;
  };

  it('A approving L1 would orphan L2 -> 409 APROBACION_BLOQUEARIA_NIVEL, no mutation; B approves, then A closes it', async () => {
    overlap();
    const r = await sent();
    const before = JSON.stringify(row(r._id));
    const err = await approveV(r._id, actor(s.A)).then(() => null, (e) => e);
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'APROBACION_BLOQUEARIA_NIVEL');
    assert.deepEqual(err.details.niveles, [{ orden: 2, nombre: 'Comité' }]);
    assert.equal(JSON.stringify(row(r._id)), before);
    assert.equal((await approveV(r._id, actor(s.B))).aprobacion.nivelActual, 2);
    assert.equal((await approveV(r._id, actor(s.A))).estado, 'Aprobada');
  });

  it('reject is never blocked by the guard', async () => {
    overlap();
    const r = await sent();
    const out = await requisicionApprovalService.reject(T, r._id, actor(s.A), { version: row(r._id).version, observacion: 'no' });
    assert.equal(out.estado, 'Rechazada');
  });

  it('the last level has nothing left to orphan and is never blocked', async () => {
    overlap();
    const r = await sent();
    await approveV(r._id, actor(s.B));
    assert.equal((await approveV(r._id, actor(s.A))).estado, 'Aprobada');
  });
});

describe('N2 / N3 reasignar hardening', () => {
  it('N2: the acting user cannot assign himself (400 SEPARACION_FUNCIONES), even with manage-all; nothing changes', async () => {
    const r = await create({ lineas: big(7000000) });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    const before = JSON.stringify(row(r._id));
    await rejectsWith(
      requisicionApprovalService.reassign(T, r._id, actor(s.director, { canManageAll: true }), { nivelOrden: 1, aprobadorIds: [s.director._id] }),
      400,
      'SEPARACION_FUNCIONES',
    );
    assert.equal(JSON.stringify(row(r._id)), before);
  });

  it('N3: reasignar bumps the version, so a decision read before it fails with VERSION_DESACTUALIZADA', async () => {
    const nuevo = w.addUser({ roleId: s.jefeRole._id });
    const r = await create({ lineas: big(7000000) });
    await requisicionService.enviar(T, r._id, actor(s.creator));
    const seen = row(r._id).version;
    const out = await requisicionApprovalService.reassign(T, r._id, actor(s.director, { canManageAll: true }), { nivelOrden: 1, aprobadorIds: [nuevo._id] });
    assert.equal(out.version, seen + 1);
    await rejectsWith(requisicionApprovalService.approve(T, r._id, actor(nuevo), { version: seen }), 409, 'VERSION_DESACTUALIZADA');
    assert.equal((await approveV(r._id, actor(nuevo))).aprobacion.nivelActual, 2);
  });
});

describe('vista por-aprobar keeps an explicit creadaPor filter (AND)', () => {
  it('both constraints are present', async () => {
    await requisicionService.list(T, s.jefe._id, { vista: 'por-aprobar', creadaPor: s.creator._id }, { page: 1, limit: 5 });
    assert.equal(String(w.lastFind.creadaPor), String(s.creator._id));
    assert.ok(w.lastFind.$and.some((c) => c.creadaPor?.$ne));
  });
});
