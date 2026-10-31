/**
 * requisiciones-e1-base-aprobacion, task 2.6: Requisicion model. DB-free: the update/delete hooks run BEFORE the
 * driver, so a forbidden operation is rejected on `.exec()` without any connection; allowed operations are only
 * checked through the pure inspector and the shape that `appendEvent` builds.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import {
  Requisicion,
  buildTimelineEvent,
  computeMontoEstimado,
  findForbiddenRequisicionUpdate,
} from '../../src/models/requisicion.model.js';
import { REQUISICION_ESTADO, REQUISICION_EVENTO } from '../../src/constants/requisicion.constants.js';

const oid = () => new mongoose.Types.ObjectId();
const linea = (over = {}) => ({ descripcion: 'Guantes', unidad: 'caja', cantidadSolicitada: 2, precioEstimado: 10.5, ...over });
const base = (over = {}) => ({
  tenantId: 'acme',
  consecutivo: 'REQ-2026-0001',
  titulo: 'Compra de guantes',
  tipoRequisicionId: oid(),
  areaId: oid(),
  creadaPor: oid(),
  solicitanteId: oid(),
  lineas: [linea()],
  ...over,
});

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return true;
  });
}

describe('Requisicion: defaults and derived amount', () => {
  it('starts in Borrador with an empty approval, no timeline and soft-delete defaults', async () => {
    const r = new Requisicion(base());
    await r.validate();
    assert.equal(r.estado, REQUISICION_ESTADO.BORRADOR);
    assert.equal(r.isDeleted, false);
    assert.deepEqual([...r.timeline], []);
    assert.deepEqual([...r.aprobacion.niveles], []);
    assert.equal(r.aprobacion.nivelActual, null);
    assert.equal(r.moneda, 'COP');
    assert.equal(r.prioridad, 'Media');
  });

  it('derives montoEstimado from the lines and ignores a client value', async () => {
    const r = new Requisicion(base({ montoEstimado: 999999, lineas: [linea(), linea({ cantidadSolicitada: 3, precioEstimado: 0.1 })] }));
    await r.validate();
    assert.equal(r.montoEstimado, 21.3);
  });

  it('skips cancelled lines and rounds each line to 2 decimals', async () => {
    const lineas = [linea({ cantidadSolicitada: 1, precioEstimado: 100 }), linea({ cantidadSolicitada: 5, precioEstimado: 50, estadoLinea: 'Cancelada' }), linea({ cantidadSolicitada: 1, precioEstimado: 10.555 })];
    assert.equal(computeMontoEstimado(lineas), 110.56);
    const r = new Requisicion(base({ lineas }));
    await r.validate();
    assert.equal(r.montoEstimado, 110.56);
    assert.equal(Requisicion.computeMontoEstimado([]), 0);
  });

  it('a line with a stock item keeps an immutable snapshot and starts with pending = requested', async () => {
    const r = new Requisicion(base({ lineas: [linea({ inventarioItemId: oid(), snapshot: { nombre: 'Sensor', precio: 5 } })] }));
    await r.validate();
    assert.equal(r.lineas[0].snapshot.nombre, 'Sensor');
    assert.equal(r.lineas[0].cantidadPendiente, 2);
    assert.equal(r.lineas[0].estadoLinea, 'Pendiente');
    assert.ok(r.lineas[0].lineaId);
  });

  it('requires 1 to 100 lines, positive quantities, tenant, consecutivo, type and area', async () => {
    await assert.rejects(() => new Requisicion(base({ lineas: [] })).validate(), /entre 1 y 100/);
    await assert.rejects(() => new Requisicion(base({ lineas: Array.from({ length: 101 }, () => linea()) })).validate(), /entre 1 y 100/);
    await assert.rejects(() => new Requisicion(base({ lineas: [linea({ cantidadSolicitada: 0 })] })).validate(), /mayor que cero/);
    await assert.rejects(() => new Requisicion(base({ lineas: [linea({ cantidadSolicitada: -1 })] })).validate());
    for (const field of ['tenantId', 'consecutivo', 'tipoRequisicionId', 'areaId', 'titulo', 'creadaPor']) {
      const doc = base();
      delete doc[field];
      await assert.rejects(() => new Requisicion(doc).validate(), new RegExp(field), field);
    }
    await new Requisicion(base({ lineas: Array.from({ length: 100 }, () => linea()) })).validate();
  });

  it('rejects states and events outside the enums', async () => {
    await assert.rejects(() => new Requisicion(base({ estado: 'Archivada' })).validate());
    assert.throws(() => buildTimelineEvent({ tipo: 'NO_EXISTE' }), { code: 'TIMELINE_EVENT_UNKNOWN' });
  });
});

describe('Requisicion: indexes', () => {
  it('has unique (tenantId, consecutivo) and tenant-scoped query indexes', () => {
    const indexes = Requisicion.schema.indexes();
    const find = (keys) => indexes.find(([k]) => JSON.stringify(k) === JSON.stringify(keys));
    const unique = find({ tenantId: 1, consecutivo: 1 });
    assert.ok(unique && unique[1].unique === true);
    assert.ok(find({ tenantId: 1, estado: 1, createdAt: -1 }));
    assert.ok(find({ tenantId: 1, areaId: 1, estado: 1 }));
    assert.ok(find({ tenantId: 1, creadaPor: 1, createdAt: -1 }));
    assert.ok(find({ tenantId: 1, estado: 1, 'aprobacion.nivelActual': 1 }));
    assert.ok(find({ tenantId: 1, isDeleted: 1 }));
    for (const [keys] of indexes) {
      if (!('tenantId' in keys)) assert.ok('isDeleted' in keys || Object.keys(keys).length === 1, `index without tenantId: ${JSON.stringify(keys)}`);
    }
  });
});

describe('Requisicion: append-only timeline (every forbidden operator)', () => {
  const FILTER = { _id: oid(), tenantId: 'acme' };
  const event = () => buildTimelineEvent({ tipo: REQUISICION_EVENTO.CREADA, actorId: oid() });
  afterEach(() => { /* nothing is stubbed: forbidden updates fail before reaching the driver */ });

  const forbidden = {
    '$set timeline': { $set: { timeline: [] } },
    '$set timeline element': { $set: { 'timeline.0.tipo': 'X' } },
    '$set timeline subfield (dotted)': { $set: { 'timeline.0.observacion': 'x' } },
    '$unset timeline': { $unset: { timeline: '' } },
    '$pull timeline': { $pull: { timeline: { tipo: 'CREADA' } } },
    '$pullAll timeline': { $pullAll: { timeline: [] } },
    '$pop timeline': { $pop: { timeline: -1 } },
    '$rename timeline (source)': { $rename: { timeline: 'otro' } },
    '$rename into timeline': { $rename: { otro: 'timeline' } },
    '$addToSet timeline': { $addToSet: { timeline: {} } },
    '$push with $position': { $push: { timeline: { $each: [{ tipo: 'CREADA' }], $position: 0 } } },
    '$push with $slice': { $push: { timeline: { $each: [{ tipo: 'CREADA' }], $slice: -1 } } },
    '$push with $sort': { $push: { timeline: { $each: [{ tipo: 'CREADA' }], $sort: { fecha: -1 } } } },
    '$push to a timeline element': { $push: { 'timeline.0.datos': 1 } },
    '$push of an array as an element': { $push: { timeline: [{ tipo: 'CREADA' }] } },
    '$min timeline': { $min: { 'timeline.0.fecha': new Date(0) } },
    '$currentDate timeline': { $currentDate: { 'timeline.0.fecha': true } },
    '$setOnInsert timeline': { $setOnInsert: { timeline: [] } },
    'implicit $set (top-level path)': { timeline: [] },
    'implicit $set (dotted path)': { 'timeline.0.tipo': 'X' },
    'aggregation pipeline update': [{ $set: { estado: 'Aprobada' } }],
  };

  for (const [name, update] of Object.entries(forbidden)) {
    it(`rejects ${name} (inspector, updateOne, updateMany, findOneAndUpdate)`, async () => {
      const err = findForbiddenRequisicionUpdate(update);
      assert.ok(err, 'inspector must flag it');
      assert.equal(err.code, 'TIMELINE_INMUTABLE');
      await rejects(Requisicion.updateOne(FILTER, update).exec(), 'TIMELINE_INMUTABLE');
      await rejects(Requisicion.updateMany(FILTER, update).exec(), 'TIMELINE_INMUTABLE');
      await rejects(Requisicion.findOneAndUpdate(FILTER, update).exec(), 'TIMELINE_INMUTABLE');
    });
  }

  it('rejects replacements', async () => {
    await rejects(Requisicion.replaceOne(FILTER, base()).exec(), 'TIMELINE_INMUTABLE');
    await rejects(Requisicion.findOneAndReplace(FILTER, base()).exec(), 'TIMELINE_INMUTABLE');
  });

  it('rejects bulkWrite replacements, deletes and forbidden updates', async () => {
    await rejects(Requisicion.bulkWrite([{ replaceOne: { filter: FILTER, replacement: base() } }]), 'TIMELINE_INMUTABLE');
    await rejects(Requisicion.bulkWrite([{ deleteOne: { filter: FILTER } }]), 'TIMELINE_INMUTABLE');
    await rejects(Requisicion.bulkWrite([{ updateOne: { filter: FILTER, update: { $set: { timeline: [] } } } }]), 'TIMELINE_INMUTABLE');
  });

  it('allows a legal append ($push.$each only, with other fields set in the same write)', () => {
    assert.equal(findForbiddenRequisicionUpdate({ $push: { timeline: { $each: [event()] } } }), null);
    assert.equal(findForbiddenRequisicionUpdate({ $push: { timeline: event() } }), null);
    assert.equal(
      findForbiddenRequisicionUpdate({
        $set: { estado: 'Enviada', 'aprobacion.nivelActual': 1, 'aprobacion.niveles.$[n].estado': 'Aprobado' },
        $inc: { 'lineas.0.cantidadSurtida': 1 },
        $push: { timeline: { $each: [event(), event()] } },
      }),
      null,
    );
    assert.equal(findForbiddenRequisicionUpdate({ $set: { isDeleted: true, deletedAt: new Date() } }), null);
    assert.equal(findForbiddenRequisicionUpdate(null), null);
  });

  it('save() on an existing document with a modified timeline is rejected; a new document may carry its first event', async () => {
    const fresh = new Requisicion(base({ timeline: [event()] }));
    await fresh.validate();
    // Run only the pre('save') guard of a persisted-looking document.
    const persisted = new Requisicion(base());
    persisted.isNew = false;
    persisted.timeline.push(event());
    await rejects(persisted.save({ validateBeforeSave: false }), 'TIMELINE_INMUTABLE');
  });

  it('appendEvent builds a single atomic $push.$each plus the transition set, and refuses a filter without tenantId', async () => {
    const calls = [];
    const original = Requisicion.findOneAndUpdate;
    Requisicion.findOneAndUpdate = (filter, update, options) => { calls.push({ filter, update, options }); return Promise.resolve({ ok: true }); };
    try {
      const e = event();
      await Requisicion.appendEvent({ ...FILTER, estado: 'Borrador' }, [e], { set: { estado: 'Enviada' }, inc: { x: 1 } });
      assert.equal(calls.length, 1, 'one write');
      assert.deepEqual(calls[0].update.$push, { timeline: { $each: [e] } });
      assert.deepEqual(calls[0].update.$set, { estado: 'Enviada' });
      assert.deepEqual(calls[0].filter.estado, 'Borrador');
      assert.equal(calls[0].options.new, true);
      assert.throws(() => Requisicion.appendEvent({ _id: FILTER._id }, [e]), /tenantId/);
      assert.throws(() => Requisicion.appendEvent(FILTER, []), /at least one event/);
    } finally {
      Requisicion.findOneAndUpdate = original;
    }
    // ... and what it builds passes the guards.
    await rejects(Requisicion.appendEvent(FILTER, [event()], { set: { timeline: [] } }).exec(), 'TIMELINE_INMUTABLE');
  });

  it('buildTimelineEvent records actor, states and observation; no actor means system', () => {
    const user = oid();
    const e = buildTimelineEvent({ tipo: 'ENVIADA', actorId: user, estadoAnterior: 'Borrador', estadoNuevo: 'Enviada', observacion: 'ok' });
    assert.equal(e.actor.tipo, 'usuario');
    assert.equal(String(e.actor.usuarioId), String(user));
    assert.equal(e.estadoNuevo, 'Enviada');
    assert.equal(e.observacion, 'ok');
    assert.ok(e.eventId && e.fecha instanceof Date);
    assert.equal(buildTimelineEvent({ tipo: 'APROBADA' }).actor.tipo, 'sistema');
  });
});

describe('Requisicion: tipo immutable, identity immutable, no physical delete', () => {
  const FILTER = { _id: oid(), tenantId: 'acme' };

  it('rejects any update touching tipoRequisicionId with 400 TIPO_INMUTABLE', async () => {
    for (const update of [
      { $set: { tipoRequisicionId: oid() } },
      { tipoRequisicionId: oid() },
      { $unset: { tipoRequisicionId: '' } },
      { $rename: { tipoRequisicionId: 'x' } },
    ]) {
      const err = findForbiddenRequisicionUpdate(update);
      assert.equal(err.code, 'TIPO_INMUTABLE');
      assert.equal(err.statusCode, 400);
      await rejects(Requisicion.findOneAndUpdate(FILTER, update).exec(), 'TIPO_INMUTABLE');
    }
  });

  it('declares tenantId, consecutivo and tipoRequisicionId as immutable paths', () => {
    for (const p of ['tenantId', 'consecutivo', 'tipoRequisicionId']) assert.equal(Requisicion.schema.path(p).options.immutable, true, p);
  });

  it('never deletes physically: query and document deletes are rejected', async () => {
    await rejects(Requisicion.deleteOne(FILTER).exec(), 'REQUISICION_NO_DELETE');
    await rejects(Requisicion.deleteMany(FILTER).exec(), 'REQUISICION_NO_DELETE');
    await rejects(Requisicion.findOneAndDelete(FILTER).exec(), 'REQUISICION_NO_DELETE');
    const doc = new Requisicion(base());
    await rejects(doc.deleteOne(), 'REQUISICION_NO_DELETE');
  });

  it('soft delete is a legal update', () => {
    assert.equal(findForbiddenRequisicionUpdate({ $set: { isDeleted: true, deletedAt: new Date() } }), null);
  });

  it('toJSON hides soft-delete fields', async () => {
    const r = new Requisicion(base());
    const json = r.toJSON();
    assert.equal('isDeleted' in json, false);
    assert.equal('deletedAt' in json, false);
    assert.equal(json.consecutivo, 'REQ-2026-0001');
  });
});
