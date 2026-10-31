/**
 * requisiciones-e2-solicitudes-recepcion, tasks 4.2 / 4.3 / 4.4 / 4.5: closing a line short, automatic closing of the
 * requisition and the stock pair at confirmation. DB-free.
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
const confirmed = (cantidad, resultado = 'Incompleto') => ({ confirmacion: { por: oid(), fecha: new Date(), resultado, cantidad } });
const closer = () => user(oid());
/** A line already disputed with `conf` units confirmed out of 2 received. */
const disputed = (conf) => ({
  line: { estadoLinea: 'En_Disputa', cantidadRecibida: conf, cantidadConfirmada: conf },
  rec: confirmed(conf, conf > 0 ? 'Incompleto' : 'No_Llego'),
});

describe('cerrarLinea: cierre con faltante', () => {
  it('without motivo -> 400 MOTIVO_REQUERIDO and nothing changes', async () => {
    const s = f.seed(disputed(1));
    for (const motivo of [undefined, '', '   ']) {
      await assert.rejects(svc.cerrarLinea(T, s.id, s.lineaId, closer(), { motivo }), rej(400, 'MOTIVO_REQUERIDO'));
    }
    assert.equal(f.w.writes.count, 0);
  });

  it('with 1 of 2 confirmed: line Confirmada with cierre, solicitud Disponible with cantidadConfirmada 1, LINEA_CERRADA', async () => {
    const s = f.seed({ ...disputed(1), extraLines: [{ lineaId: oid(), descripcion: 'Otra', unidad: 'und', cantidadSolicitada: 1, precioEstimado: 5, estadoLinea: 'Pendiente' }] });
    const actor = closer();
    const out = await svc.cerrarLinea(T, s.id, s.lineaId, actor, { motivo: 'El proveedor no tiene más' });
    const l = f.line(s.id, s.lineaId);
    assert.equal(l.estadoLinea, 'Confirmada');
    assert.equal(l.cierre.motivo, 'El proveedor no tiene más');
    assert.equal(String(l.cierre.por), actor.userId);
    assert.ok(l.cierre.fecha);
    assert.equal(sol(s.solicitud).requisicion.disponibilidad, 'Disponible');
    assert.equal(sol(s.solicitud).requisicion.cantidadConfirmada, 1);
    const ev = f.doc(s.id).timeline.find((e) => e.tipo === 'LINEA_CERRADA');
    assert.ok(ev);
    assert.equal(ev.observacion, 'El proveedor no tiene más');
    assert.equal(out.estado, 'En_Recepcion', 'the other line is still pending');
  });

  it('with nothing confirmed: line Cancelada, solicitud released, LINEA_CANCELADA, monto recomputed', async () => {
    const s = f.seed({ ...disputed(0), extraLines: [{ lineaId: oid(), descripcion: 'Otra', unidad: 'und', cantidadSolicitada: 1, precioEstimado: 5, estadoLinea: 'Pendiente' }] });
    await svc.cerrarLinea(T, s.id, s.lineaId, closer(), { motivo: 'Se descontinuó' });
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Cancelada');
    assert.equal(sol(s.solicitud).requisicion, undefined, 'unlinked');
    assert.ok(f.doc(s.id).timeline.some((e) => e.tipo === 'LINEA_CANCELADA'));
    assert.equal(f.doc(s.id).montoEstimado, 5);
    assert.ok(f.traces.some((t) => /libre/.test(t.Comentarios)));
  });

  it('a line still Pendiente (nothing received) can be cancelled with a reason', async () => {
    const s = f.seed({ line: { estadoLinea: 'Pendiente', cantidadRecibida: 0 }, rec: { cantidadRecibida: 0 } });
    f.doc(s.id).recepciones = [];
    await svc.cerrarLinea(T, s.id, s.lineaId, closer(), { motivo: 'Ya no se necesita' });
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Cancelada');
  });

  it('items received and not yet confirmed block the closing: 409 CONFIRMACIONES_PENDIENTES', async () => {
    const s = f.seed();
    await assert.rejects(svc.cerrarLinea(T, s.id, s.lineaId, closer(), { motivo: 'x' }), rej(409, 'CONFIRMACIONES_PENDIENTES'));
    assert.equal(f.w.writes.count, 0);
  });

  it('an already Confirmada line, an unknown line and another tenant', async () => {
    const s = f.seed({ line: { estadoLinea: 'Confirmada', cantidadConfirmada: 2 }, rec: confirmed(2, 'Recibido'), extraLines: [{ lineaId: oid(), descripcion: 'O', unidad: 'u', cantidadSolicitada: 1, precioEstimado: 1, estadoLinea: 'Pendiente' }] });
    await assert.rejects(svc.cerrarLinea(T, s.id, s.lineaId, closer(), { motivo: 'x' }), rej(409, 'LINEA_NO_CERRABLE'));
    await assert.rejects(svc.cerrarLinea(T, s.id, oid(), closer(), { motivo: 'x' }), rej(404, 'LINEA_NOT_FOUND'));
    await assert.rejects(svc.cerrarLinea('other', s.id, s.lineaId, closer(), { motivo: 'x' }), rej(404));
  });

  it('notifies the line closing outside the critical path', async () => {
    const s = f.seed(disputed(1));
    await svc.cerrarLinea(T, s.id, s.lineaId, closer(), { motivo: 'Faltante' });
    await flushRequisicionNotifications();
    assert.ok(f.w.emits.some((e) => e.event === 'requisicion.line.closed'));
  });
});

describe('cierre automático de la requisición', () => {
  it('closing the last pending line closes the requisition (CERRADA) and notifies', async () => {
    const s = f.seed(disputed(1));
    const out = await svc.cerrarLinea(T, s.id, s.lineaId, closer(), { motivo: 'Faltante aceptado' });
    assert.equal(out.estado, 'Cerrada');
    assert.equal(f.doc(s.id).timeline.at(-1).tipo, 'CERRADA');
    await flushRequisicionNotifications();
    assert.ok(f.w.emits.some((e) => e.event === 'requisicion.closed'));
  });

  it('closes only when EVERY active line is Confirmada or Cancelada (a Cancelada one does not block)', async () => {
    const other = { lineaId: oid(), descripcion: 'Otra', unidad: 'u', cantidadSolicitada: 1, precioEstimado: 1, estadoLinea: 'Cancelada' };
    const s = f.seed({ extraLines: [other] });
    const out = await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    assert.equal(out.estado, 'Cerrada');

    const pend = { lineaId: oid(), descripcion: 'Otra', unidad: 'u', cantidadSolicitada: 1, precioEstimado: 1, estadoLinea: 'Pendiente' };
    const t = f.seed({ extraLines: [pend] });
    const out2 = await svc.confirmar(T, t.id, t.recepcionId, user(t.responsable), confirmItems(t.lineaId));
    assert.equal(out2.estado, 'En_Recepcion');
  });

  it('a Cerrada requisition rejects every operation with 409 TRANSICION_INVALIDA', async () => {
    const s = f.seed();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    assert.equal(f.doc(s.id).estado, 'Cerrada');
    const writes = f.w.writes.count;
    await assert.rejects(svc.registrar(T, s.id, closer(), { items: [{ lineaId: s.lineaId, cantidadRecibida: 1 }] }), rej(409, 'TRANSICION_INVALIDA'));
    // the identical retry of the confirmation that closed it is an idempotent success (A5), a different outcome is not
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego', { observacion: 'x' })), rej(409, 'ENTREGA_YA_CONFIRMADA'));
    await assert.rejects(svc.cerrarLinea(T, s.id, s.lineaId, closer(), { motivo: 'x' }), rej(409, 'TRANSICION_INVALIDA'));
    assert.equal(f.w.writes.count, writes);
  });
});

describe('stock al confirmar (Stock avanzado)', () => {
  const ON = { usesRequisiciones: true, usesInventoryBasic: true, usesInventoryAdvanced: true };
  const itemId = oid();
  const withItem = (over = {}) => f.seed({ line: { inventarioItemId: itemId }, ...over });

  it('registers a PAIRED entrada + salida of the confirmed quantity, net zero, and marks the solicitud', async () => {
    const s = withItem();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON);
    assert.deepEqual(f.stock.calls.map((c) => c.tipo), ['entrada', 'salida']);
    for (const c of f.stock.calls) {
      assert.equal(c.cantidad, 2);
      assert.equal(c.referenciaTipo, 'requisicion');
      assert.equal(c.referenciaId, s.id);
      assert.equal(String(c.itemId), itemId);
      assert.match(c.motivo, /REQ-2026-/);
    }
    assert.equal(f.stock.levels.get(itemId), 0);
    assert.equal(sol(s.solicitud).stockDescontadoPor, 'requisicion');
  });

  it('moves only the confirmed quantity of an Incompleto', async () => {
    const s = withItem();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'Incompleto', { cantidad: 1, observacion: 'Falta' }), ON);
    assert.deepEqual(f.stock.calls.map((c) => c.cantidad), [1, 1]);
  });

  it('No_Llego moves nothing (and does not mark the solicitud)', async () => {
    const s = withItem();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego', { observacion: 'Nada' }), ON);
    assert.equal(f.stock.calls.length, 0);
    assert.equal(sol(s.solicitud).stockDescontadoPor, undefined);
  });

  it('a line without inventarioItemId moves nothing', async () => {
    const s = f.seed();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON);
    assert.equal(f.stock.calls.length, 0);
  });

  it('without Stock advanced nothing moves and the solicitud is not marked', async () => {
    const s = withItem();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), { usesRequisiciones: true, usesInventoryAdvanced: false });
    assert.equal(f.stock.calls.length, 0);
    assert.equal(sol(s.solicitud).stockDescontadoPor, undefined);
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Confirmada');
  });

  it('no double discount: a repeated identical confirmation is idempotent and a different outcome is 409; no extra movement', async () => {
    const s = withItem({ line: { inventarioItemId: itemId, cantidadSolicitada: 4, estadoLinea: 'Recibida_Parcial' } });
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON);
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON);
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego', { observacion: 'x' }), ON), rej(409, 'ENTREGA_YA_CONFIRMADA'));
    assert.equal(f.stock.calls.length, 2);
    assert.equal(f.line(s.id, s.lineaId).cantidadConfirmada, 2);
  });

  it('the item was deleted (entrada: NOT_FOUND): the confirmation proceeds WITHOUT stock and records stockOmitido (B4)', async () => {
    const s = withItem();
    f.stock.failOn = () => true;
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON);
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Confirmada');
    assert.equal(f.stock.calls.length, 0);
    assert.equal(sol(s.solicitud).stockDescontadoPor, undefined);
    assert.equal(f.doc(s.id).timeline.find((e) => e.tipo === 'ENTREGA_CONFIRMADA').datos.stockOmitido, 'item_no_disponible');
  });

  it('the salida fails after the entrada: the entrada is compensated (net zero) and nothing is confirmed', async () => {
    const s = withItem();
    f.stock.failOn = (d) => d.tipo === 'salida' && !/^Reversa/.test(d.motivo);
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON), rej(409, 'STOCK_MOVIMIENTO_FALLIDO'));
    assert.equal(f.stock.levels.get(itemId), 0, 'entrada undone');
    assert.equal(f.doc(s.id).recepciones[0].items[0].confirmacion, undefined);
    assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Recibida');
    assert.equal(f.w.writes.count, 0);
  });
});

describe('security M3: stockDescontadoPor marker travels with the stock pair', () => {
  const ON = { usesRequisiciones: true, usesInventoryBasic: true, usesInventoryAdvanced: true };
  const itemId = oid();
  const withItem = () => f.seed({ line: { inventarioItemId: itemId } });

  it('without a session the marker is written BEFORE the stock pair', async () => {
    const s = withItem();
    const seen = [];
    f.stock.failOn = () => { seen.push(sol(s.solicitud).stockDescontadoPor); return false; };
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON);
    assert.deepEqual(seen, ['requisicion', 'requisicion'], 'marker already set when each movement runs');
    assert.equal(sol(s.solicitud).stockDescontadoPor, 'requisicion');
  });

  it('failure order 1: the stock pair fails -> marker cleared, nothing discounted', async () => {
    const s = withItem();
    f.stock.failOn = (d) => d.tipo === 'salida' && !/^Reversa/.test(d.motivo);
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON), rej(409, 'STOCK_MOVIMIENTO_FALLIDO'));
    assert.equal(sol(s.solicitud).stockDescontadoPor, undefined);
    assert.equal(f.stock.levels.get(String(itemId)), 0);
  });

  it('failure order 2: the stock pair succeeds but the confirmation write fails -> stock reversed AND marker cleared', async () => {
    const s = withItem();
    const { Requisicion } = await import('../../src/models/requisicion.model.js');
    const original = Requisicion.appendEvent;
    Requisicion.appendEvent = () => { throw new Error('db down'); };
    try {
      await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON), /db down/);
    } finally {
      Requisicion.appendEvent = original;
    }
    assert.equal(sol(s.solicitud).stockDescontadoPor, undefined);
    assert.equal(f.stock.levels.get(String(itemId)), 0, 'entrada+salida+reversals net to zero');
    assert.equal(f.doc(s.id).recepciones[0].items[0].confirmacion, undefined);
  });

  it('a failure never clears a marker written by an EARLIER confirmation of the same solicitud', async () => {
    const s = withItem();
    sol(s.solicitud).stockDescontadoPor = 'requisicion';
    f.stock.failOn = (d) => d.tipo === 'salida' && !/^Reversa/.test(d.motivo);
    await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON), rej(409, 'STOCK_MOVIMIENTO_FALLIDO'));
    assert.equal(sol(s.solicitud).stockDescontadoPor, 'requisicion');
  });

  it('with a session the marker is written inside the same transaction (session passed, after the pair, before the confirmation)', async () => {
    const s = withItem();
    const session = { withTransaction: async (fn) => { await fn(); }, endSession: async () => {} };
    svc.deps.startSession = async () => session;
    const { Repuestos } = await import('../../src/models/repuestos.model.js');
    const originalUpdate = Repuestos.updateOne;
    const order = [];
    Repuestos.updateOne = async (filter, update, options) => { if (update.$set?.stockDescontadoPor) order.push(['marker', options?.session === session]); return originalUpdate(filter, update, options); };
    const baseCreate = svc.deps.movimientos.create;
    svc.deps.movimientos = { create: async (...a) => { order.push(['stock', a[3]?.session === session]); return baseCreate(...a); } };
    try {
      await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON);
    } finally {
      Repuestos.updateOne = originalUpdate;
    }
    assert.deepEqual(order, [['stock', true], ['stock', true], ['marker', true]]);
    assert.equal(sol(s.solicitud).stockDescontadoPor, 'requisicion');
  });
});

describe('security M6: the write endpoints keep the RAW capability check (rollout off/warn does not relax it)', () => {
  let savedMode;
  beforeEach(() => { savedMode = process.env.ENFORCE_TENANT_CAPABILITIES; });
  afterEach(() => { if (savedMode === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES; else process.env.ENFORCE_TENANT_CAPABILITIES = savedMode; });

  it('registrar, confirmar and cerrarLinea answer 403 CAPABILITY_DISABLED for a tenant without usesRequisiciones, with the mode off or warn', async () => {
    const s = f.seed();
    const OFF = { usesRequisiciones: false, usesInventoryAdvanced: true };
    for (const mode of ['off', 'warn']) {
      process.env.ENFORCE_TENANT_CAPABILITIES = mode;
      const bad = rej(403, 'CAPABILITY_DISABLED');
      await assert.rejects(svc.registrar(T, s.id, closer(), { items: [{ lineaId: s.lineaId, cantidadRecibida: 1 }] }, [], OFF), bad, mode);
      await assert.rejects(svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), OFF), bad, mode);
      await assert.rejects(svc.cerrarLinea(T, s.id, s.lineaId, closer(), { motivo: 'x' }, OFF), bad, mode);
    }
    assert.equal(f.w.writes.count, 0);
    assert.equal(f.stock.calls.length, 0);
  });
});
