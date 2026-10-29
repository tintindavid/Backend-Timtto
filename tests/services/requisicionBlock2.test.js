/**
 * requisiciones-e2-solicitudes-recepcion, section 11 (adversarial fixes A1, A5, B1, B4, B5). DB-free.
 * The Mongo versions of A1 / A5 live in tests/integration/requisicion.e2.block2.mongo.integration.test.js.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { repuestosService } from '../../src/services/repuestos.service.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Report } from '../../src/models/report.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { RepuestoTrazabilidad } from '../../src/models/repuestotrazabilidad.model.js';
import { User } from '../../src/models/user.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { notificationService } from '../../src/services/notification.service.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { setupFixture, svc, T as FT, confirmItems, user } from '../helpers/requisicionConfirmFixture.js';

const oid = () => new mongoose.Types.ObjectId();
const T = 'tenant-a';
const ON = { usesRequisiciones: true };
const RESP = '507f1f77bcf86cd799439012';
const MANAGER = { userId: 'u-mgr', permissions: [PERMISSIONS.REQUISICIONES_MANAGE_ALL] };
const link = (disponibilidad, extra = {}) => ({ requisicionId: oid(), lineaId: oid(), consecutivo: 'REQ-2026-0001', disponibilidad, cantidadConfirmada: 0, ...extra });

const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
let savedEnforce;
beforeEach(() => {
  savedEnforce = process.env.ENFORCE_TENANT_CAPABILITIES; process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
  stub(Requisicion, 'find', (filter) => ({
    lean: async () => filter._id.$in.map((id) => ({ _id: String(id), estado: 'En_Recepcion', consecutivo: 'REQ-2026-0001', lineas: [] })),
  }));
});
afterEach(() => {
  while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; }
  if (savedEnforce === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES; else process.env.ENFORCE_TENANT_CAPABILITIES = savedEnforce;
});

// ------------------------------------------------------------------------------------------------ B1 locks

describe('B1: a linked, not available solicitud also locks status / install quantity / OT / equipment / price', () => {
  let written;
  function arrange(current) {
    written = [];
    stub(Repuestos, 'findOne', () => ({ lean: async () => current }));
    stub(Repuestos, 'findOneAndUpdate', async (filter, update) => { written.push(update); return { _id: filter._id, tenantId: T, requisicion: current.requisicion, toJSON() { return {}; }, ...update.$set }; });
    stub(RepuestoTrazabilidad, 'create', async () => ({}));
  }
  const pending = (over = {}) => ({
    _id: 'r1', tenantId: T, nombre: 'Sensor', Cantidad: '2', EstadoSolicitud: 'Solicitado', CantidadInstalacion: 2, OrdenId: 'o1', EquipoId: 'e1', PrecioRepuesto: 10,
    requisicion: link('En_Abastecimiento'), ...over,
  });
  const locked = (data) => assert.rejects(() => repuestosService.update('r1', data, T, ON), (e) => e.statusCode === 409 && e.code === 'SOLICITUD_EN_REQUISICION');

  it('rejects ANY status change (Rechazado, Cancelado, arbitrary) and the new fields; accepts unchanged values', async () => {
    arrange(pending());
    for (const EstadoSolicitud of ['Rechazado', 'Cancelado', 'Instalado', 'lo-que-sea']) await locked({ EstadoSolicitud });
    await locked({ CantidadInstalacion: 5 });
    await locked({ OrdenId: 'o2' });
    await locked({ EquipoId: 'e2' });
    await locked({ PrecioRepuesto: 99 });
    assert.equal(written.length, 0);
    // the form sends the whole object back: unchanged values + another field is not an edit
    await repuestosService.update('r1', { EstadoSolicitud: 'Solicitado', CantidadInstalacion: '2', OrdenId: 'o1', EquipoId: 'e1', PrecioRepuesto: 10, observacion: 'nota' }, T, ON);
    assert.equal(written.length, 1);
  });

  it('setting a field that was empty counts as a change', async () => {
    arrange(pending({ OrdenId: undefined, PrecioRepuesto: null }));
    await locked({ OrdenId: 'o9' });
    await locked({ PrecioRepuesto: 5 });
  });

  it('Disponible, unlinked and module OFF are unchanged', async () => {
    arrange(pending({ requisicion: link('Disponible') }));
    await repuestosService.update('r1', { EstadoSolicitud: 'Rechazado', CantidadInstalacion: 9, PrecioRepuesto: 1 }, T, ON);
    arrange(pending({ requisicion: undefined }));
    await repuestosService.update('r1', { EstadoSolicitud: 'Rechazado', EquipoId: 'e2' }, T, ON);
    arrange(pending());
    await repuestosService.update('r1', { EstadoSolicitud: 'Rechazado', EquipoId: 'e2' }, T, { usesRequisiciones: false });
    assert.equal(written.length, 1);
  });
});

// ------------------------------------------------------------------------------------------------ A1 omit

describe('A1: omitirRequisicion only applies to solicitudes WITHOUT a requisition link', () => {
  let found; let otCreated; let bulk;
  function arrange(rows) {
    found = rows; otCreated = 0; bulk = null;
    stub(Repuestos, 'find', () => ({ lean: async () => found }));
    stub(Repuestos, 'updateMany', async (filter) => { bulk = filter; return { modifiedCount: found.length }; });
    stub(OT, 'create', async () => { otCreated += 1; return { _id: 'ot-1', Consecutivo: 'OT000001', reportes: [], save: async () => {} }; });
    stub(Report, 'create', async () => ({ _id: 'rep-1' }));
    stub(EquipoItem, 'findOne', () => ({ populate() { return this; }, lean: async () => ({ Marca: 'M' }) }));
    let seq = 0;
    stub(Counter, 'findOneAndUpdate', () => ({ lean: async () => ({ seq: ++seq }) }));
    stub(RepuestoTrazabilidad, 'create', async (doc) => doc);
    stub(User, 'find', () => ({ populate: () => ({ lean: async () => [{ _id: RESP, tenantId: T, isDeleted: false, firstName: 'A', lastName: 'B', roleId: { permissions: ['ots:can-be-responsible'] } }] }) }));
    stub(Customer, 'findById', () => ({ select: () => ({ lean: async () => ({ Razonsocial: 'C' }) }) }));
    stub(notificationService, 'emit', async () => ({ dispatched: 0 }));
  }
  const sol = (id, over = {}) => ({ _id: id, tenantId: T, EquipoId: 'e1', EstadoSolicitud: 'Solicitado', ClienteId: 'c1', ReporteSolicitudId: 'rep1', ...over });
  const create = (ids, extra = {}) => repuestosService.createOtFromSolicitudes({
    repuestoIds: ids,
    responsableUserIds: [RESP],
    fechaInicio: new Date(Date.now() + 86400000).toISOString(),
    fechaFin: new Date(Date.now() + 3 * 86400000).toISOString(),
    omitirRequisicion: true,
    motivoOmision: 'Urgente',
    ...extra,
  }, T, MANAGER, { capabilities: ON });

  it('a linked solicitud that is not Disponible -> 409 SOLICITUD_EN_REQUISICION with the ids, no OT, no write (no double stock discount)', async () => {
    for (const d of ['En_Requisicion', 'En_Aprobacion', 'En_Abastecimiento', 'Recibida', 'En_Disputa']) {
      arrange([sol('free'), sol('linked', { requisicion: link(d) })]);
      await assert.rejects(() => create(['free', 'linked']), (e) => e.statusCode === 409 && e.code === 'SOLICITUD_EN_REQUISICION'
        && JSON.stringify(e.details.ids) === JSON.stringify(['linked']) && /cierra o cancela/.test(e.message), d);
      assert.equal(otCreated, 0, d);
      assert.equal(bulk, null, d);
    }
  });

  it('unlinked and Disponible solicitudes still work with the omission', async () => {
    arrange([sol('free'), sol('ok', { requisicion: link('Disponible') })]);
    const out = await create(['free', 'ok']);
    assert.equal(out.repuestosActualizados, 2);
    assert.equal(otCreated, 1);
  });

  it('a self-healed stale link counts as unlinked', async () => {
    const stale = sol('stale', { requisicion: link('En_Abastecimiento') });
    stubs.push([Requisicion, 'find', Requisicion.find]);
    Requisicion.find = () => ({ lean: async () => [] }); // the requisition does not exist any more -> the link is stale
    stub(Repuestos, 'updateOne', async () => ({ modifiedCount: 1 }));
    stub(Repuestos, 'updateMany', async () => ({ modifiedCount: 1 }));
    arrange([stale]);
    const out = await create(['stale']);
    assert.equal(out.repuestosActualizados, 1);
  });
});

// ------------------------------------------------------------------------------------------------ A5 / B4 / B5

describe('A5 / B4 / B5: confirmation retry, missing stock item, snapshot recipients', () => {
  let f;
  beforeEach(() => { f = setupFixture(); });
  afterEach(async () => { await flushRequisicionNotifications(); f.restore(); });
  const rej = (status, code) => (e) => e.statusCode === status && e.code === code;
  const ON_ALL = { usesRequisiciones: true, usesInventoryBasic: true, usesInventoryAdvanced: true };
  const events = (name) => f.w.emits.filter((e) => e.event === name);

  it('A5: retrying the confirmation that CLOSED the requisition is an idempotent success (no write, no stock, no notification)', async () => {
    const itemId = oid();
    const s = f.seed({ line: { inventarioItemId: itemId } });
    const first = await svc.confirmar(FT, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON_ALL);
    assert.equal(first.estado, 'Cerrada');
    await flushRequisicionNotifications();
    const writes = f.w.writes.count;
    const calls = f.stock.calls.length;
    const emitted = f.w.emits.length;
    const again = await svc.confirmar(FT, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON_ALL);
    await flushRequisicionNotifications();
    assert.equal(again.estado, 'Cerrada');
    assert.equal(f.w.writes.count, writes, 'no new write');
    assert.equal(f.stock.calls.length, calls, 'no second stock movement');
    assert.equal(f.w.emits.length, emitted, 'no notification re-fired');
  });

  it('A5: a different outcome or a different actor on the Cerrada requisition still gets ENTREGA_YA_CONFIRMADA / 403', async () => {
    const s = f.seed();
    await svc.confirmar(FT, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId));
    await assert.rejects(svc.confirmar(FT, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'No_Llego', { observacion: 'x' })), rej(409, 'ENTREGA_YA_CONFIRMADA'));
    await assert.rejects(svc.confirmar(FT, s.id, s.recepcionId, user(), confirmItems(s.lineaId)), rej(403, 'NO_ES_RESPONSABLE'));
    await assert.rejects(svc.confirmar(FT, s.id, s.recepcionId, user(oid(), true), confirmItems(s.lineaId)), rej(409, 'ENTREGA_YA_CONFIRMADA'));
  });

  it('A5: a Cerrada / Cancelada requisition rejects NEW confirmations with TRANSICION_INVALIDA', async () => {
    for (const estado of ['Cerrada', 'Cancelada']) {
      const s = f.seed({ estado });
      await assert.rejects(svc.confirmar(FT, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId)), rej(409, 'TRANSICION_INVALIDA'), estado);
    }
    assert.equal(f.w.writes.count, 0);
  });

  it('B5: an idempotent retry on a still open requisition does not re-fire the available / disputed notices', async () => {
    const ok = f.seed({ line: { cantidadSolicitada: 4, estadoLinea: 'Recibida_Parcial' } });
    await svc.confirmar(FT, ok.id, ok.recepcionId, user(ok.responsable), confirmItems(ok.lineaId));
    const dis = f.seed();
    await svc.confirmar(FT, dis.id, dis.recepcionId, user(dis.responsable), confirmItems(dis.lineaId, 'No_Llego', { observacion: 'Vacía' }));
    await flushRequisicionNotifications();
    const before = f.w.emits.length;
    await svc.confirmar(FT, ok.id, ok.recepcionId, user(ok.responsable), confirmItems(ok.lineaId));
    await svc.confirmar(FT, dis.id, dis.recepcionId, user(dis.responsable), confirmItems(dis.lineaId, 'No_Llego', { observacion: 'Vacía' }));
    await flushRequisicionNotifications();
    assert.equal(f.w.emits.length, before);
  });

  it('B5: delivery notices go to the SNAPSHOT responsible, not to the live ResponsableSolicitud', async () => {
    const snapshot = oid();
    const live = oid();
    const s = f.seed({ responsable: live, line: { responsableId: snapshot } });
    await svc.confirmar(FT, s.id, s.recepcionId, user(snapshot), confirmItems(s.lineaId));
    await flushRequisicionNotifications();
    const ev = events('requisicion.delivery.confirmed');
    assert.equal(ev.length, 1);
    const recipients = ev[0].options.extraRecipientUserIds.map(String);
    assert.ok(recipients.includes(String(snapshot)));
    assert.ok(!recipients.includes(String(live)));
  });

  it('B4: a missing stock item confirms without stock (no marker), records stockOmitido, even for manage-all', async () => {
    for (const manage of [false, true]) {
      const itemId = oid();
      const s = f.seed({ line: { inventarioItemId: itemId } });
      f.stock.failOn = () => true; // NOT_FOUND on the first movement
      const actor = manage ? user(oid(), true) : user(s.responsable);
      await svc.confirmar(FT, s.id, s.recepcionId, actor, confirmItems(s.lineaId), ON_ALL);
      assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Confirmada');
      assert.equal(f.stock.calls.length, 0);
      assert.equal(f.solicitudes.find((x) => x._id === s.solicitud._id).stockDescontadoPor, undefined);
      assert.equal(f.doc(s.id).timeline.find((e) => e.tipo === 'ENTREGA_CONFIRMADA').datos.stockOmitido, 'item_no_disponible');
    }
  });

  it('B4: another stock failure (NOT_FOUND after the entrada) still fails with 409 STOCK_MOVIMIENTO_FALLIDO and undoes everything', async () => {
    const itemId = oid();
    const s = f.seed({ line: { inventarioItemId: itemId } });
    f.stock.failOn = (d) => d.tipo === 'salida' && !/^Reversa/.test(d.motivo);
    await assert.rejects(svc.confirmar(FT, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId), ON_ALL), rej(409, 'STOCK_MOVIMIENTO_FALLIDO'));
    assert.equal(f.stock.levels.get(String(itemId)), 0);
    assert.equal(f.doc(s.id).recepciones[0].items[0].confirmacion, undefined);
    assert.equal(f.solicitudes.find((x) => x._id === s.solicitud._id).stockDescontadoPor, undefined);
  });
});
