/**
 * requisiciones-e2-solicitudes-recepcion, tasks 4.1 / 4.5: confirming a delivery, disputes and who may confirm
 * (requirements "Confirmación de entrega" and "Resolver una disputa" of requisition-reception). DB-free.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { setupFixture, svc, T, oid, confirmItems, user } from '../helpers/requisicionConfirmFixture.js';

let f;
beforeEach(() => { f = setupFixture(); });
afterEach(async () => { await flushRequisicionNotifications(); f.restore(); });

const sol = (s) => f.solicitudes.find((x) => x._id === s._id);
const rej = (status, code) => (e) => e.statusCode === status && (code === undefined || e.code === code);

describe('confirmar: Recibido', () => {
  it('the responsible confirms the full quantity: line Confirmada, solicitud Disponible, ENTREGA_CONFIRMADA, requisition closes', async () => {
    const s = f.seed();
    const out = await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    const l = f.line(s.id, s.lineaId);
    assert.equal(l.estadoLinea, 'Confirmada');
    assert.equal(l.cantidadConfirmada, 2);
    assert.equal(l.cantidadRecibida, 2);
    assert.equal(sol(s.solicitud).requisicion.disponibilidad, 'Disponible');
    assert.equal(sol(s.solicitud).requisicion.cantidadConfirmada, 2);
    assert.ok(f.doc(s.id).timeline.some((e) => e.tipo === 'ENTREGA_CONFIRMADA'));
    assert.equal(out.estado, 'Cerrada', 'the only line is confirmed -> automatic closing');
    assert.ok(f.traces.some((t) => /Disponible|disponible/.test(t.Comentarios)));
    const item = f.doc(s.id).recepciones[0].items[0];
    assert.equal(item.confirmacion.resultado, 'Recibido');
    assert.equal(String(item.confirmacion.por), s.responsable);
  });

  it('a free line (no origin solicitud) is confirmed by the requisition requester', async () => {
    const s = f.seed({ withOrigen: false });
    await svc.confirmar(T, s.id, s.recepcionId, user(s.solicitante), confirmItems(s.lineaId));
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Confirmada');
  });

  it('Recibido with a different quantity is a 400 and writes nothing', async () => {
    const s = f.seed();
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'Recibido', { cantidad: 1 })), rej(400, 'CANTIDAD_INVALIDA'));
    assert.equal(f.w.writes.count, 0);
  });

  it('partial reception confirmed in full stays Recibida_Parcial (not closed)', async () => {
    const s = f.seed({ line: { estadoLinea: 'Recibida_Parcial', cantidadSolicitada: 5, cantidadRecibida: 2 } });
    const out = await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Recibida_Parcial');
    assert.equal(f.line(s.id, s.lineaId).cantidadConfirmada, 2);
    assert.equal(out.estado, 'En_Recepcion');
    assert.equal(sol(s.solicitud).requisicion.disponibilidad, 'En_Abastecimiento');
  });

  it('with another unconfirmed reception pending the line stays Recibida', async () => {
    const s = f.seed({ line: { cantidadSolicitada: 4, cantidadRecibida: 4, estadoLinea: 'Recibida' } });
    f.doc(s.id).recepciones.push({ recepcionId: oid(), fecha: new Date(), recibidaPor: s.recibidaPor, evidencias: [], items: [{ lineaId: s.lineaId, cantidadRecibida: 2 }] });
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Recibida');
    assert.equal(sol(s.solicitud).requisicion.disponibilidad, 'Recibida');
  });
});

describe('confirmar: No llegó / Incompleto -> disputa', () => {
  it('No_Llego needs an observation (400) and quantity 0', async () => {
    const s = f.seed();
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego')), rej(400, 'OBSERVACION_REQUERIDA'));
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego', { cantidad: 1, observacion: 'x' })), rej(400, 'CANTIDAD_INVALIDA'));
    assert.equal(f.w.writes.count, 0);
  });

  it('No_Llego: line and solicitud En_Disputa, ENTREGA_DISPUTADA, the received quantity is given back, who received is notified', async () => {
    const s = f.seed();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego', { observacion: 'La caja venía vacía' }));
    await flushRequisicionNotifications();
    const l = f.line(s.id, s.lineaId);
    assert.equal(l.estadoLinea, 'En_Disputa');
    assert.equal(l.cantidadConfirmada, 0);
    assert.equal(l.cantidadRecibida, 0, 'the whole quantity can be received again');
    assert.equal(sol(s.solicitud).requisicion.disponibilidad, 'En_Disputa');
    assert.equal(f.doc(s.id).estado, 'En_Recepcion');
    const ev = f.doc(s.id).timeline.at(-1);
    assert.equal(ev.tipo, 'ENTREGA_DISPUTADA');
    assert.equal(ev.observacion, 'La caja venía vacía');
    const emit = f.w.emits.find((e) => e.event === 'requisicion.delivery.disputed');
    assert.ok(emit, 'dispute notification');
    assert.ok(JSON.stringify(emit).includes(s.recibidaPor));
  });

  it('Incompleto validates 0 < cantidad < recibida and requires an observation', async () => {
    const s = f.seed();
    const bad = (extra, code) => assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'Incompleto', extra)), rej(400, code));
    await bad({ observacion: 'x' }, 'CANTIDAD_INVALIDA');
    await bad({ cantidad: 0, observacion: 'x' }, 'CANTIDAD_INVALIDA');
    await bad({ cantidad: 2, observacion: 'x' }, 'CANTIDAD_INVALIDA');
    await bad({ cantidad: 1 }, 'OBSERVACION_REQUERIDA');
    assert.equal(f.w.writes.count, 0);
  });

  it('Incompleto: adjusts cantidadRecibida down so the missing part is re-receivable, keeps the confirmed part', async () => {
    const s = f.seed();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'Incompleto', { cantidad: 1, observacion: 'Faltó una' }));
    const l = f.line(s.id, s.lineaId);
    assert.equal(l.estadoLinea, 'En_Disputa');
    assert.equal(l.cantidadConfirmada, 1);
    assert.equal(l.cantidadRecibida, 1);
    assert.equal(l.cantidadSolicitada - l.cantidadRecibida, 1, 're-receivable = solicitada - cantidadRecibida');
    assert.equal(sol(s.solicitud).requisicion.disponibilidad, 'En_Disputa');
    assert.equal(f.doc(s.id).timeline.at(-1).tipo, 'ENTREGA_DISPUTADA');
  });
});

describe('confirmar: who may confirm', () => {
  it('a user who is not the responsible gets 403 NO_ES_RESPONSABLE and nothing changes', async () => {
    const s = f.seed();
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(), confirmItems(s.lineaId)), rej(403, 'NO_ES_RESPONSABLE'));
    assert.equal(f.w.writes.count, 0);
  });

  it('the requester of the requisition cannot confirm a line whose origin solicitud has another responsible', async () => {
    const s = f.seed();
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.solicitante), confirmItems(s.lineaId)), rej(403, 'NO_ES_RESPONSABLE'));
  });

  it('the user who registered the reception cannot confirm it (SEPARACION_FUNCIONES), even being the responsible', async () => {
    const me = oid();
    const s = f.seed({ responsable: me, recibidaPor: me });
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(me), confirmItems(s.lineaId)), rej(403, 'SEPARACION_FUNCIONES'));
    assert.equal(f.w.writes.count, 0);
  });

  it('manage-all may confirm any item, including the ones he received', async () => {
    const me = oid();
    const s = f.seed({ recibidaPor: me });
    await svc.confirmar(T, s.id, s.recepcionId, user(me, true), confirmItems(s.lineaId));
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Confirmada');
  });

  it('security M2: the manage-all bypass is recorded (porManageAll) in the confirmation and the timeline; a normal confirmation is not', async () => {
    const me = oid();
    const s = f.seed({ recibidaPor: me });
    await svc.confirmar(T, s.id, s.recepcionId, user(me, true), confirmItems(s.lineaId));
    const conf = f.doc(s.id).recepciones[0].items[0].confirmacion;
    assert.equal(conf.porManageAll, true);
    assert.equal(f.doc(s.id).timeline.find((e) => e.tipo === 'ENTREGA_CONFIRMADA').datos.porManageAll, true);
    const n = f.seed();
    await svc.confirmar(T, n.id, n.recepcionId, user(n.responsable), confirmItems(n.lineaId));
    assert.equal(f.doc(n.id).recepciones[0].items[0].confirmacion.porManageAll, undefined);
    assert.equal(f.doc(n.id).timeline.find((e) => e.tipo === 'ENTREGA_CONFIRMADA').datos.porManageAll, undefined);
    // manage-all who IS the responsible and did not receive: no bypass used
    const r = oid();
    const m = f.seed({ responsable: r });
    await svc.confirmar(T, m.id, m.recepcionId, user(r, true), confirmItems(m.lineaId));
    assert.equal(f.doc(m.id).recepciones[0].items[0].confirmacion.porManageAll, undefined);
  });

  it('security H2: the responsible is the snapshot of the line, not the current ResponsableSolicitud of the solicitud', async () => {
    const attacker = oid();
    const s = f.seed();
    f.line(s.id, s.lineaId).responsableId = s.responsable;
    // a user with repuestos:update reassigned the solicitud to himself behind the lock
    f.solicitudes.find((x) => x._id === s.solicitud._id).ResponsableSolicitud = attacker;
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(attacker), confirmItems(s.lineaId)), rej(403, 'NO_ES_RESPONSABLE'));
    assert.equal(f.w.writes.count, 0);
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Confirmada');
  });

  it('security M1: without requisiciones:read the response is a minimal payload; with read or manage-all it is the full requisition', async () => {
    const s = f.seed({ line: { cantidadSolicitada: 4, estadoLinea: 'Recibida_Parcial' } });
    const min = await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    assert.deepEqual(Object.keys(min).sort(), ['_id', 'consecutivo', 'estado', 'items']);
    assert.equal(min.estado, 'En_Recepcion');
    assert.deepEqual(min.items, [{ lineaId: s.lineaId, resultado: 'Recibido', cantidad: 2 }]);
    assert.equal(min.lineas, undefined);
    assert.equal(min.timeline, undefined);
    const r = oid();
    const t = f.seed({ responsable: r, line: { cantidadSolicitada: 4, estadoLinea: 'Recibida_Parcial' } });
    const full = await svc.confirmar(T, t.id, t.recepcionId, { ...user(r), canRead: true }, confirmItems(t.lineaId));
    assert.ok(Array.isArray(full.lineas) && Array.isArray(full.timeline));
  });

  it('another tenant requisition is a 404', async () => {
    const s = f.seed();
    await assert.rejects(svc.confirmar('other', s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId)), rej(404));
  });

  it('unknown reception 404, line not in the reception 404, state not En_Recepcion 409', async () => {
    const s = f.seed();
    await assert.rejects(svc.confirmar(T, s.id, oid(), user(s.responsable), confirmItems(s.lineaId)), rej(404, 'RECEPCION_NOT_FOUND'));
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(oid())), rej(404, 'ITEM_NO_ENCONTRADO'));
    const a = f.seed({ estado: 'Aprobada' });
    await assert.rejects(svc.confirmar(T, a.id, a.recepcionId, user(a.responsable), confirmItems(a.lineaId)), rej(409, 'TRANSICION_INVALIDA'));
  });
});

describe('confirmar: only once', () => {
  it('a second confirmation with a DIFFERENT outcome (or by another actor) is 409 and modifies nothing', async () => {
    const s = f.seed({ line: { cantidadSolicitada: 4, estadoLinea: 'Recibida_Parcial' } });
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    const writes = f.w.writes.count;
    const before = JSON.stringify(f.doc(s.id));
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego', { observacion: 'x' })), rej(409, 'ENTREGA_YA_CONFIRMADA'));
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'Incompleto', { cantidad: 1, observacion: 'x' })), rej(409, 'ENTREGA_YA_CONFIRMADA'));
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(undefined, true), confirmItems(s.lineaId)), rej(409, 'ENTREGA_YA_CONFIRMADA'));
    assert.equal(f.w.writes.count, writes);
    assert.equal(JSON.stringify(f.doc(s.id)), before);
  });

  it('security M4: re-sending the SAME outcome by the same actor is an idempotent success (no second write)', async () => {
    const s = f.seed({ line: { cantidadSolicitada: 4, estadoLinea: 'Recibida_Parcial' } });
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    const writes = f.w.writes.count;
    const out = await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    assert.equal(out.estado, 'En_Recepcion');
    assert.equal(f.line(s.id, s.lineaId).cantidadConfirmada, 2);
    assert.equal(f.w.writes.count, writes);
  });

  it('security M4: retry after a partial failure of a multi-item confirmation finishes the remaining items', async () => {
    const s = f.seed();
    const lineaB = oid();
    f.doc(s.id).lineas.push({ lineaId: lineaB, descripcion: 'Cable', unidad: 'und', cantidadSolicitada: 1, precioEstimado: 1, estadoLinea: 'Recibida', cantidadRecibida: 1, cantidadConfirmada: 0, origenSolicitudRepuestoId: s.solicitud._id });
    f.doc(s.id).recepciones[0].items.push({ lineaId: lineaB, cantidadRecibida: 1 });
    const body = { items: [{ lineaId: s.lineaId, resultado: 'Recibido' }, { lineaId: lineaB, resultado: 'Recibido' }] };
    // first attempt: the second write dies (a failure after the first item was committed)
    const original = svc._confirmOne.bind(svc);
    let calls = 0;
    svc._confirmOne = async (...a) => { calls += 1; if (calls === 2) throw new Error('boom'); return original(...a); };
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), body), /boom/);
    delete svc._confirmOne;
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Confirmada');
    assert.equal(f.doc(s.id).recepciones[0].items[1].confirmacion, undefined);
    const confirmedBefore = f.doc(s.id).timeline.filter((e) => e.tipo === 'ENTREGA_CONFIRMADA').length;
    // retry of the whole request: the first item is already done (no error, no second event), the second is applied
    const out = await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), body);
    assert.equal(out.estado, 'Cerrada');
    assert.equal(f.line(s.id, lineaB).estadoLinea, 'Confirmada');
    assert.equal(f.doc(s.id).timeline.filter((e) => e.tipo === 'ENTREGA_CONFIRMADA').length, confirmedBefore + 1);
  });

  it('two parallel identical confirmations: the quantity is counted once (the loser is an idempotent success)', async () => {
    const s = f.seed({ line: { cantidadSolicitada: 4, estadoLinea: 'Recibida_Parcial' } });
    const run = () => svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    const res = await Promise.allSettled([run(), run()]);
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 2);
    assert.equal(f.line(s.id, s.lineaId).cantidadConfirmada, 2);
    assert.equal(f.doc(s.id).timeline.filter((e) => e.tipo === 'ENTREGA_CONFIRMADA').length, 1);
  });

  it('two parallel confirmations with different outcomes: exactly one wins, the other is 409', async () => {
    const s = f.seed({ line: { cantidadSolicitada: 4, estadoLinea: 'Recibida_Parcial' } });
    const a = () => svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    const b = () => svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego', { observacion: 'x' }));
    const res = await Promise.allSettled([a(), b()]);
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(res.find((r) => r.status === 'rejected').reason.statusCode, 409);
  });
});

describe('disputa: nueva recepción y reconfirmación', () => {
  it('after a dispute a new reception is accepted, the solicitud goes to Recibida and the re-confirmation makes it Disponible', async () => {
    const s = f.seed();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego', { observacion: 'Vacía' }));
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'En_Disputa');

    await svc.registrar(T, s.id, user(s.recibidaPor), { items: [{ lineaId: s.lineaId, cantidadRecibida: 2 }] });
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Recibida');
    assert.equal(sol(s.solicitud).requisicion.disponibilidad, 'Recibida');

    const second = f.doc(s.id).recepciones[1];
    const out = await svc.confirmar(T, s.id, second.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Confirmada');
    assert.equal(f.line(s.id, s.lineaId).cantidadConfirmada, 2);
    assert.equal(sol(s.solicitud).requisicion.disponibilidad, 'Disponible');
    assert.equal(out.estado, 'Cerrada');
  });

  it('Incompleto 1 of 2, then the missing unit is received and confirmed -> Confirmada with 2', async () => {
    const s = f.seed();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'Incompleto', { cantidad: 1, observacion: 'Falta una' }));
    await svc.registrar(T, s.id, user(s.recibidaPor), { items: [{ lineaId: s.lineaId, cantidadRecibida: 1 }] });
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Recibida');
    await svc.confirmar(T, s.id, f.doc(s.id).recepciones[1].recepcionId, user(s.responsable), confirmItems(s.lineaId));
    assert.equal(f.line(s.id, s.lineaId).cantidadConfirmada, 2);
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Confirmada');
    assert.equal(f.doc(s.id).estado, 'Cerrada');
  });
});

describe('DTOs y vista por-confirmar', () => {
  it('the list query accepts vista=por-confirmar and the confirm body is validated', async () => {
    const { queryRequisicionDto, confirmarEntregaDto, REQUISICION_VISTAS } = await import('../../src/dtos/requisicion.dto.js');
    assert.ok(REQUISICION_VISTAS.includes('por-confirmar'));
    assert.equal(queryRequisicionDto.validate({ vista: 'por-confirmar' }).error, undefined);
    assert.ok(confirmarEntregaDto.validate({ items: [{ lineaId: oid(), resultado: 'Otro' }] }).error);
    assert.ok(confirmarEntregaDto.validate({ items: [] }).error);
    assert.ok(confirmarEntregaDto.validate({ items: [{ lineaId: oid(), resultado: 'Recibido' }], tenantId: 'x' }).error);
  });

  it('the list view filters by En_Recepcion and applies the unconfirmed-items expression', async () => {
    const { requisicionService } = await import('../../src/services/requisicion.service.js');
    await requisicionService.list(T, oid(), { vista: 'por-confirmar' }, { page: 1, limit: 10 }, { canManageAll: true });
    const and = f.w.lastFind.$and;
    assert.ok(and.some((c) => c.estado === 'En_Recepcion'));
    assert.ok(and.some((c) => c.$expr));
  });
});
