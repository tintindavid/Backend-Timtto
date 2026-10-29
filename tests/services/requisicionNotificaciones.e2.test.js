/**
 * requisiciones-e2-solicitudes-recepcion, task 6.4: recipients of the E2 notifications, actor exclusion, resilience
 * (a failing emit never breaks the operation) and event without rule. DB-free.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { flushRequisicionNotifications, notifyRequisicion } from '../../src/services/requisicionNotify.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { NotificationRule } from '../../src/models/notificationRule.model.js';
import { NOTIFICATION_EVENTS } from '../../src/config/notificationEvents.js';
import { REQUISICION_PAYLOAD_BUILDERS } from '../../src/services/notifications/requisicionPayload.util.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { setupFixture, svc, T, oid, confirmItems, user } from '../helpers/requisicionConfirmFixture.js';

let f;
beforeEach(() => { f = setupFixture(); });
afterEach(async () => { await flushRequisicionNotifications(); f.restore(); });

const emitsOf = (event) => f.w.emits.filter((e) => e.event === event);
const recipientsOf = (e) => [...(e.options.extraRecipientUserIds || [])].sort();
const sorted = (...ids) => ids.map(String).sort();
const settle = async () => { await flushRequisicionNotifications(); };

describe('E2 events are registered and have a payload builder', () => {
  const E2 = ['requisicion.delivery.registered', 'requisicion.delivery.confirmed', 'requisicion.delivery.disputed', 'requisicion.line.closed', 'requisicion.closed'];
  it('allow-list and builders contain every new event', () => {
    for (const ev of E2) {
      assert.ok(NOTIFICATION_EVENTS.includes(ev), ev);
      const p = REQUISICION_PAYLOAD_BUILDERS[ev]({ requisicionId: 'r1', consecutivo: 'REQ-1', actorName: 'Ana', descripcion: 'Sensor' });
      assert.ok(p.title && p.body && p.data.link, ev);
    }
  });

  it('the available notice links to /repuestos/solicitados, the others to the requisition', () => {
    const conf = REQUISICION_PAYLOAD_BUILDERS['requisicion.delivery.confirmed']({ requisicionId: 'r1', consecutivo: 'REQ-1' });
    assert.equal(conf.data.link, '/repuestos/solicitados');
    assert.match(conf.body, /instalarlo/);
    const reg = REQUISICION_PAYLOAD_BUILDERS['requisicion.delivery.registered']({ requisicionId: 'r1' });
    assert.equal(reg.data.link, '/requisiciones/r1');
    assert.match(reg.body, /Confirma que lo recibiste/);
  });
});

describe('recipients per event', () => {
  it('delivery.registered: the responsible of the solicitud included; the actor is excluded', async () => {
    const s = f.seed({ line: { estadoLinea: 'Pendiente', cantidadRecibida: 0, cantidadConfirmada: 0 }, rec: {} });
    const actor = user(oid());
    notifyRequisicion(T, 'requisicion.delivery.registered', f.doc(s.id), { actorId: actor.userId, actorName: 'Rita', lineaIds: [s.lineaId] });
    await settle();
    const [e] = emitsOf('requisicion.delivery.registered');
    assert.deepEqual(recipientsOf(e), sorted(s.responsable));
    assert.deepEqual(e.options.excludeRecipientUserIds, [actor.userId]);
  });

  it('delivery.registered emits exactly once per call', async () => {
    const s = f.seed();
    notifyRequisicion(T, 'requisicion.delivery.registered', f.doc(s.id), { lineaIds: [s.lineaId] });
    await settle();
    assert.equal(emitsOf('requisicion.delivery.registered').length, 1);
  });

  it('delivery.registered: a free line (no solicitud) notifies the requisition requester', async () => {
    const s = f.seed({ withOrigen: false });
    notifyRequisicion(T, 'requisicion.delivery.registered', f.doc(s.id), { lineaIds: [s.lineaId] });
    await settle();
    assert.deepEqual(recipientsOf(emitsOf('requisicion.delivery.registered')[0]), sorted(s.solicitante));
  });

  it('delivery.confirmed: one notice per newly Disponible solicitud, to its responsible + the requester, nobody excluded', async () => {
    const s = f.seed();
    const out = await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'Recibido'));
    assert.ok(out);
    await settle();
    const list = emitsOf('requisicion.delivery.confirmed');
    assert.equal(list.length, 1);
    assert.deepEqual(recipientsOf(list[0]), sorted(s.responsable, s.solicitante));
    assert.deepEqual(list[0].options.excludeRecipientUserIds, []);
    assert.equal(list[0].payload.data.link, '/repuestos/solicitados');
    assert.equal(emitsOf('requisicion.delivery.disputed').length, 0);
  });

  it('delivery.disputed: the one who registered the reception + every manage-all holder; the actor is excluded', async () => {
    const role = f.w.addRole([PERMISSIONS.REQUISICIONES_MANAGE_ALL]);
    const boss = f.w.addUser({ roleId: role._id });
    const plain = f.w.addRole([PERMISSIONS.REQUISICIONES_READ || 'requisiciones:read']);
    f.w.addUser({ roleId: plain._id });
    const s = f.seed();
    const actor = user(s.responsable);
    await svc.confirmar(T, s.id, s.recepcionId, actor, confirmItems(s.lineaId, 'No_Llego', { observacion: 'Caja vacía' }));
    await settle();
    const [e] = emitsOf('requisicion.delivery.disputed');
    assert.deepEqual(recipientsOf(e), sorted(s.recibidaPor, boss._id));
    assert.deepEqual(e.options.excludeRecipientUserIds, [s.responsable]);
    assert.match(e.payload.body, /Caja vacía/);
  });

  it('line.closed: requester/creator + the responsible of the closed line, actor excluded', async () => {
    const s = f.seed({ line: { estadoLinea: 'En_Disputa', cantidadRecibida: 1, cantidadConfirmada: 1 }, rec: { confirmacion: { por: oid(), fecha: new Date(), resultado: 'Incompleto', cantidad: 1 } } });
    const actor = user(oid());
    await svc.cerrarLinea(T, s.id, s.lineaId, actor, { motivo: 'Sin más existencias' });
    await settle();
    const [e] = emitsOf('requisicion.line.closed');
    assert.ok(recipientsOf(e).includes(String(s.responsable)));
    assert.ok(recipientsOf(e).includes(String(s.solicitante)));
    assert.deepEqual(e.options.excludeRecipientUserIds, [actor.userId]);
    assert.match(e.payload.body, /Sin más existencias/);
  });

  it('requisicion.closed: creator + requester when the last line gets confirmed', async () => {
    const s = f.seed();
    await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'Recibido'));
    await settle();
    const [e] = emitsOf('requisicion.closed');
    assert.ok(e, 'closed notification');
    assert.ok(recipientsOf(e).includes(String(s.solicitante)));
    assert.equal(f.doc(s.id).estado, 'Cerrada');
  });
});

describe('approved / rejected / cancelled also reach the solicitud responsibles', () => {
  for (const event of ['requisicion.approved', 'requisicion.rejected']) {
    it(`${event}: creator, requester and the responsible of the linked solicitud`, async () => {
      const s = f.seed();
      const req = { ...f.doc(s.id), creadaPor: oid() };
      notifyRequisicion(T, event, req, { actorId: oid(), reason: 'x' });
      await settle();
      const r = recipientsOf(emitsOf(event)[0]);
      for (const id of [s.responsable, s.solicitante, req.creadaPor]) assert.ok(r.includes(String(id)), `${event} -> ${id}`);
    });
  }

  it('cancelled: the responsible of a released line is told; one with goods already confirmed is not', async () => {
    const a = f.seed({ line: { estadoLinea: 'Pendiente', cantidadRecibida: 0, cantidadConfirmada: 0 } });
    notifyRequisicion(T, 'requisicion.cancelled', f.doc(a.id), { actorId: oid(), reason: 'x' });
    await settle();
    assert.ok(recipientsOf(emitsOf('requisicion.cancelled')[0]).includes(String(a.responsable)));

    f.w.emits.length = 0;
    const b = f.seed({ line: { estadoLinea: 'Confirmada', cantidadRecibida: 2, cantidadConfirmada: 2 } });
    notifyRequisicion(T, 'requisicion.cancelled', f.doc(b.id), { actorId: oid(), reason: 'x' });
    await settle();
    assert.ok(!recipientsOf(emitsOf('requisicion.cancelled')[0]).includes(String(b.responsable)));
  });
});

describe('resilience', () => {
  it('a failing emit never breaks the confirmation: the operation succeeds and persists', async () => {
    const s = f.seed();
    const prev = notificationService.emit;
    let calls = 0;
    notificationService.emit = async () => { calls += 1; throw new Error('emit boom'); };
    try {
      const out = await svc.confirmar(T, s.id, s.recepcionId, user(s.responsable), confirmItems(s.lineaId, 'Recibido'));
      await settle();
      assert.ok(out);
      assert.ok(calls >= 2, 'delivery.confirmed and closed were attempted');
      assert.equal(f.doc(s.id).estado, 'Cerrada');
    } finally {
      notificationService.emit = prev;
    }
  });

  it('a failure resolving recipients is swallowed (notifyRequisicion never rejects)', async () => {
    const s = f.seed();
    const broken = { ...f.doc(s.id), lineas: null, get solicitanteId() { throw new Error('boom'); } };
    await assert.doesNotReject(notifyRequisicion(T, 'requisicion.delivery.confirmed', broken, {}));
  });

  it('cerrarLinea keeps working when the notification fails', async () => {
    const s = f.seed({ line: { estadoLinea: 'En_Disputa', cantidadRecibida: 0, cantidadConfirmada: 0 }, rec: { confirmacion: { por: oid(), fecha: new Date(), resultado: 'No_Llego', cantidad: 0 } } });
    const prev = notificationService.emit;
    notificationService.emit = async () => { throw new Error('emit boom'); };
    try {
      await svc.cerrarLinea(T, s.id, s.lineaId, user(oid()), { motivo: 'Cancelada' });
      await settle();
      assert.equal(f.line(s.id, s.lineaId).estadoLinea, 'Cancelada');
    } finally {
      notificationService.emit = prev;
    }
  });
});

describe('event without a rule', () => {
  it('the bus is a silent no-op (nothing dispatched) for an E2 event with no NotificationRule', async () => {
    const real = Object.getPrototypeOf(notificationService).emit;
    const saved = NotificationRule.findOne;
    NotificationRule.findOne = () => ({ lean: async () => null });
    try {
      const out = await real.call(notificationService, T, 'requisicion.delivery.confirmed', { title: 't', body: 'b' }, { extraRecipientUserIds: [oid()] });
      assert.deepEqual(out, { dispatched: 0, recipients: [] });
    } finally {
      NotificationRule.findOne = saved;
    }
  });
});
