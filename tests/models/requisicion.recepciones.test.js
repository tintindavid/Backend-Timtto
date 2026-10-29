/**
 * requisiciones-e2-solicitudes-recepcion, tasks 1.1-1.4 / 1.6: constants, model fields and the immutability guard of
 * `recepciones[]`. DB-free: the update hooks run BEFORE the driver, so a forbidden operation is rejected on `.exec()`
 * without any connection; allowed operations are checked through the pure inspector and the shape `appendEvent` builds.
 * (The same guard against a real mongod lives in tests/integration/requisicion.e2.mongo.integration.test.js.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import {
  Requisicion,
  buildTimelineEvent,
  findForbiddenRequisicionUpdate,
} from '../../src/models/requisicion.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { InventarioMovimiento, MOVIMIENTO_REFERENCIA_TIPOS } from '../../src/models/inventarioMovimiento.model.js';
import {
  CONFIRMACION_RESULTADO_VALUES,
  LINEA_ESTADO,
  LINEA_ESTADO_VALUES,
  RECEPCIONES_SOFT_CAP,
  REPUESTO_DISPONIBILIDAD_VALUES,
  REPUESTO_REQUISICION_FILTER_VALUES,
  REQUISICION_ESTADO as E,
  REQUISICION_ESTADO_VALUES,
  REQUISICION_ESTADOS_TERMINALES,
  REQUISICION_EVENTO,
  REQUISICION_EVENTO_VALUES,
  REQUISICION_TRANSICIONES as T,
  PRESUPUESTO_ESTADOS_CONSUMIDO,
} from '../../src/constants/requisicion.constants.js';
import { PERMISSIONS, PERMISSION_VALUES, PERMISSIONS_BY_RESOURCE } from '../../src/constants/permissions.js';
import { isTransitionAllowed } from '../../src/services/requisicionTransition.service.js';

const oid = () => new mongoose.Types.ObjectId();
const linea = (over = {}) => ({ descripcion: 'Guantes', unidad: 'caja', cantidadSolicitada: 2, precioEstimado: 10, ...over });
const base = (over = {}) => ({
  tenantId: 'acme',
  consecutivo: 'REQ-2026-0001',
  titulo: 'Compra',
  tipoRequisicionId: oid(),
  areaId: oid(),
  creadaPor: oid(),
  solicitanteId: oid(),
  lineas: [linea()],
  ...over,
});
const rejects = async (promise, code) => {
  await assert.rejects(promise, (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; });
};

describe('E2 constants: states, transitions, line states, events', () => {
  it('adds En_Recepcion and Cerrada keeping every E1 state', () => {
    for (const s of ['Borrador', 'Enviada', 'En_Aprobacion', 'Aprobada', 'Rechazada', 'Cancelada', 'En_Recepcion', 'Cerrada']) {
      assert.ok(REQUISICION_ESTADO_VALUES.includes(s), s);
    }
  });

  it('transition table: Aprobada -> En_Recepcion | Cerrada | Cancelada; En_Recepcion -> Cerrada | Cancelada; Cerrada terminal', () => {
    assert.deepEqual([...T[E.APROBADA]].sort(), [E.CANCELADA, E.CERRADA, E.EN_RECEPCION].sort());
    assert.deepEqual([...T[E.EN_RECEPCION]].sort(), [E.CANCELADA, E.CERRADA].sort());
    assert.deepEqual(T[E.CERRADA], []);
    assert.deepEqual(T[E.CANCELADA], []);
    assert.deepEqual([...REQUISICION_ESTADOS_TERMINALES].sort(), [E.CANCELADA, E.CERRADA].sort());
  });

  it('Cancelada is reachable from every non-terminal state, and from no terminal one', () => {
    for (const s of REQUISICION_ESTADO_VALUES) {
      const terminal = REQUISICION_ESTADOS_TERMINALES.includes(s);
      assert.equal(isTransitionAllowed(s, E.CANCELADA), !terminal, s);
    }
  });

  it('E1 transitions are unchanged', () => {
    assert.deepEqual([...T[E.BORRADOR]].sort(), [E.CANCELADA, E.ENVIADA].sort());
    assert.deepEqual([...T[E.EN_APROBACION]].sort(), [E.APROBADA, E.BORRADOR, E.CANCELADA, E.RECHAZADA].sort());
    assert.deepEqual([...T[E.RECHAZADA]].sort(), [E.BORRADOR, E.CANCELADA].sort());
  });

  it('the budget counts a requisition as consumed from approval until closing', () => {
    assert.deepEqual([...PRESUPUESTO_ESTADOS_CONSUMIDO].sort(), [E.APROBADA, E.CERRADA, E.EN_RECEPCION].sort());
  });

  it('line states and timeline events', () => {
    assert.deepEqual([...LINEA_ESTADO_VALUES].sort(), ['Cancelada', 'Confirmada', 'En_Disputa', 'Pendiente', 'Recibida', 'Recibida_Parcial'].sort());
    for (const ev of ['RECEPCION_REGISTRADA', 'ENTREGA_CONFIRMADA', 'ENTREGA_DISPUTADA', 'LINEA_CERRADA', 'LINEA_CANCELADA', 'CERRADA']) {
      assert.ok(REQUISICION_EVENTO_VALUES.includes(ev), ev);
    }
    assert.equal(buildTimelineEvent({ tipo: REQUISICION_EVENTO.RECEPCION_REGISTRADA, actorId: oid() }).tipo, 'RECEPCION_REGISTRADA');
  });

  it('disponibilidad keeps the E1 values and adds En_Abastecimiento, Recibida and En_Disputa', () => {
    assert.deepEqual(
      [...REPUESTO_DISPONIBILIDAD_VALUES].sort(),
      ['Cancelada', 'Disponible', 'En_Abastecimiento', 'En_Aprobacion', 'En_Camino', 'En_Compra', 'En_Disputa', 'En_Requisicion', 'Recibida'].sort(),
    );
    assert.deepEqual([...CONFIRMACION_RESULTADO_VALUES].sort(), ['Incompleto', 'No_Llego', 'Recibido']);
    assert.ok(REPUESTO_REQUISICION_FILTER_VALUES.includes('sin') && REPUESTO_REQUISICION_FILTER_VALUES.includes('con'));
  });

  it('permission requisiciones:receive is in the catalog under its resource', () => {
    assert.equal(PERMISSIONS.REQUISICIONES_RECEIVE, 'requisiciones:receive');
    assert.ok(PERMISSION_VALUES.includes('requisiciones:receive'));
    assert.ok(PERMISSIONS_BY_RESOURCE.requisiciones.includes('requisiciones:receive'));
    assert.equal(new Set(PERMISSION_VALUES).size, PERMISSION_VALUES.length);
  });
});

describe('E2 models: Requisicion fields, Repuestos link, stock reference', () => {
  it('accepts the new states and the new line fields (cantidadRecibida / cantidadConfirmada)', async () => {
    for (const estado of [E.EN_RECEPCION, E.CERRADA]) await new Requisicion(base({ estado })).validate();
    const doc = new Requisicion(base({ lineas: [linea({ estadoLinea: LINEA_ESTADO.EN_DISPUTA })] }));
    await doc.validate();
    assert.equal(doc.lineas[0].cantidadRecibida, 0);
    assert.equal(doc.lineas[0].cantidadConfirmada, 0);
    await rejects(new Requisicion(base({ lineas: [linea({ estadoLinea: 'Otra' })] })).validate().catch((e) => { throw Object.assign(e, { code: 'X' }); }), 'X');
  });

  it('recepciones defaults to [] and validates items, results, quantities and the cap', async () => {
    const empty = new Requisicion(base());
    await empty.validate();
    assert.deepEqual(empty.recepciones.toObject(), []);

    const item = (over = {}) => ({ lineaId: oid(), cantidadRecibida: 2, ...over });
    const rec = (over = {}) => ({ recibidaPor: oid(), documento: 'REM-1', items: [item()], evidencias: [{ nombre: 'f.pdf', url: 'https://x/y', tipo: 'application/pdf' }], ...over });
    const ok = new Requisicion(base({ recepciones: [rec()] }));
    await ok.validate();
    assert.ok(ok.recepciones[0].recepcionId);
    assert.deepEqual(Object.keys(ok.recepciones[0].evidencias[0].toObject()).sort(), ['nombre', 'tipo', 'url']);

    await assert.rejects(new Requisicion(base({ recepciones: [rec({ items: [] })] })).validate());
    await assert.rejects(new Requisicion(base({ recepciones: [rec({ items: [item({ cantidadRecibida: 0 })] })] })).validate());
    await assert.rejects(new Requisicion(base({ recepciones: [rec({ recibidaPor: undefined })] })).validate());
    const conf = (over) => ({ por: oid(), fecha: new Date(), resultado: 'Recibido', cantidad: 2, ...over });
    await new Requisicion(base({ recepciones: [rec({ items: [item({ confirmacion: conf() })] })] })).validate();
    await assert.rejects(new Requisicion(base({ recepciones: [rec({ items: [item({ confirmacion: conf({ resultado: 'Nada' }) })] })] })).validate());
    await assert.rejects(new Requisicion(base({ recepciones: [rec({ items: [item({ confirmacion: conf({ cantidad: -1 }) })] })] })).validate());

    assert.equal(RECEPCIONES_SOFT_CAP, 200);
    await new Requisicion(base({ recepciones: Array.from({ length: 200 }, () => rec()) })).validate();
    await assert.rejects(new Requisicion(base({ recepciones: Array.from({ length: 201 }, () => rec()) })).validate());
  });

  it('Repuestos.requisicion carries consecutivo and cantidadConfirmada, accepts the new disponibilidad values, and stays out of toJSON', async () => {
    const link = { requisicionId: oid(), lineaId: oid(), consecutivo: 'REQ-2026-0007', disponibilidad: 'En_Abastecimiento', cantidadConfirmada: 0 };
    const r = new Repuestos({ tenantId: 'acme', requisicion: link, stockDescontadoPor: 'requisicion' });
    assert.equal(r.requisicion.consecutivo, 'REQ-2026-0007');
    for (const d of ['En_Abastecimiento', 'Recibida', 'En_Disputa', 'En_Requisicion', 'Disponible']) {
      const doc = new Repuestos({ tenantId: 'acme', requisicion: { ...link, disponibilidad: d } });
      assert.equal(doc.validateSync()?.errors?.['requisicion.disponibilidad'], undefined, d);
    }
    const bad = new Repuestos({ tenantId: 'acme', requisicion: { ...link, disponibilidad: 'Inventada' } });
    assert.ok(bad.validateSync()?.errors?.['requisicion.disponibilidad']);
    const json = r.toJSON();
    assert.equal('requisicion' in json, false);
    assert.equal('stockDescontadoPor' in json, false);
    assert.equal('requisicion' in new Repuestos({ tenantId: 'acme' }).toObject(), false, 'no default: unlinked solicitudes have no field');
  });

  it('stock movements accept referenciaTipo requisicion', async () => {
    assert.ok(MOVIMIENTO_REFERENCIA_TIPOS.includes('requisicion'));
    for (const t of ['manual', 'OT', 'reporte']) assert.ok(MOVIMIENTO_REFERENCIA_TIPOS.includes(t));
    const mov = new InventarioMovimiento({
      tenantId: 'acme', itemId: oid(), tipo: 'entrada', cantidad: 1, stockAnterior: 0, stockResultante: 1, referenciaTipo: 'requisicion', referenciaId: String(oid()),
    });
    assert.equal(mov.validateSync(), undefined);
  });
});

describe('Requisicion.recepciones: immutability guard (every forbidden operator)', () => {
  const FILTER = { _id: oid(), tenantId: 'acme' };
  const rid = oid();
  const lid = oid();
  const AF = [{ 'rec.recepcionId': rid }, { 'itm.lineaId': lid, 'itm.confirmacion': { $exists: false } }];
  const CP = 'recepciones.$[rec].items.$[itm].confirmacion';
  const CONF = () => ({ por: oid(), fecha: new Date(), resultado: 'Recibido', cantidad: 2 });
  const recepcion = (over = {}) => ({ recepcionId: oid(), recibidaPor: oid(), items: [{ lineaId: lid, cantidadRecibida: 2 }], ...over });
  const event = () => buildTimelineEvent({ tipo: REQUISICION_EVENTO.RECEPCION_REGISTRADA, actorId: oid() });

  it('allows appending receptions and ONE guarded confirmation, alongside the timeline push and other sets', () => {
    assert.equal(findForbiddenRequisicionUpdate({ $push: { recepciones: recepcion() } }), null);
    assert.equal(findForbiddenRequisicionUpdate({ $push: { recepciones: { $each: [recepcion(), recepcion()] } } }), null);
    assert.equal(findForbiddenRequisicionUpdate({ $push: { timeline: { $each: [event()] }, recepciones: { $each: [recepcion()] } }, $set: { estado: 'En_Recepcion', 'lineas.$[lin].estadoLinea': 'Recibida' } }), null);
    assert.equal(findForbiddenRequisicionUpdate({ $set: { [CP]: CONF(), estado: 'Cerrada' }, $push: { timeline: { $each: [event()] } } }, { arrayFilters: AF }), null);
    // extra array filters for the lines do not break it
    assert.equal(findForbiddenRequisicionUpdate({ $set: { [CP]: CONF(), 'lineas.$[lin].cantidadConfirmada': 2 } }, { arrayFilters: [...AF, { 'lin.lineaId': lid }] }), null);
    // identifiers are free-form as long as the path and the filters agree
    assert.equal(findForbiddenRequisicionUpdate(
      { $set: { 'recepciones.$[r].items.$[i].confirmacion': CONF() } },
      { arrayFilters: [{ 'r.recepcionId': String(rid) }, { 'i.lineaId': String(lid), 'i.confirmacion': { $exists: false } }] },
    ), null);
  });

  const forbidden = {
    '$set recepciones': { $set: { recepciones: [] } },
    '$set recepciones element': { $set: { 'recepciones.0.documento': 'x' } },
    '$set item quantity (positional index)': { $set: { 'recepciones.0.items.0.cantidadRecibida': 99 } },
    '$set item quantity (filtered positional)': { $set: { 'recepciones.$[rec].items.$[itm].cantidadRecibida': 99 } },
    '$set recibidaPor': { $set: { 'recepciones.$[rec].recibidaPor': oid() } },
    '$set items': { $set: { 'recepciones.$[rec].items': [] } },
    '$set evidencias': { $set: { 'recepciones.$[rec].evidencias': [] } },
    '$set confirmacion by index (no array filters)': { $set: { 'recepciones.0.items.0.confirmacion': CONF() } },
    '$set confirmacion subfield (overwrite the result)': { $set: { 'recepciones.$[rec].items.$[itm].confirmacion.resultado': 'Recibido' } },
    '$set confirmacion with $[] (all items)': { $set: { 'recepciones.$[].items.$[].confirmacion': CONF() } },
    '$unset recepciones': { $unset: { recepciones: '' } },
    '$unset confirmacion': { $unset: { [CP]: '' } },
    '$pull recepciones': { $pull: { recepciones: { documento: 'x' } } },
    '$pullAll recepciones': { $pullAll: { recepciones: [] } },
    '$pop recepciones': { $pop: { recepciones: -1 } },
    '$addToSet recepciones': { $addToSet: { recepciones: {} } },
    '$rename recepciones (source)': { $rename: { recepciones: 'otro' } },
    '$rename into recepciones': { $rename: { otro: 'recepciones' } },
    '$inc item quantity': { $inc: { 'recepciones.0.items.0.cantidadRecibida': 1 } },
    '$min recepciones': { $min: { 'recepciones.0.fecha': new Date(0) } },
    '$currentDate recepciones': { $currentDate: { 'recepciones.0.fecha': true } },
    '$setOnInsert recepciones': { $setOnInsert: { recepciones: [] } },
    '$push with $position': { $push: { recepciones: { $each: [recepcion()], $position: 0 } } },
    '$push with $slice': { $push: { recepciones: { $each: [recepcion()], $slice: -1 } } },
    '$push with $sort': { $push: { recepciones: { $each: [recepcion()], $sort: { fecha: -1 } } } },
    '$push to a reception element': { $push: { 'recepciones.0.items': { lineaId: lid, cantidadRecibida: 1 } } },
    '$push into evidencias': { $push: { 'recepciones.$[rec].evidencias': { nombre: 'x' } } },
    '$push of an array as an element': { $push: { recepciones: [recepcion()] } },
    '$push of a reception born confirmed': { $push: { recepciones: recepcion({ items: [{ lineaId: lid, cantidadRecibida: 1, confirmacion: CONF() }] }) } },
    '$push $each with a confirmed item': { $push: { recepciones: { $each: [recepcion({ items: [{ lineaId: lid, cantidadRecibida: 1, confirmacion: CONF() }] })] } } },
    'implicit $set (top-level path)': { recepciones: [] },
    'implicit $set (dotted path)': { 'recepciones.0.documento': 'x' },
    'aggregation pipeline update': [{ $set: { estado: 'Cerrada' } }],
  };

  for (const [name, update] of Object.entries(forbidden)) {
    it(`rejects ${name} (inspector, updateOne, updateMany, findOneAndUpdate)`, async () => {
      const err = findForbiddenRequisicionUpdate(update, { arrayFilters: AF });
      assert.ok(err, 'inspector must flag it');
      assert.ok(['RECEPCIONES_INMUTABLES', 'TIMELINE_INMUTABLE'].includes(err.code), err.code);
      assert.equal(err.statusCode, 409);
      const opts = { arrayFilters: AF };
      await assert.rejects(Requisicion.updateOne(FILTER, update, opts).exec(), (e) => e.statusCode === 409);
      await assert.rejects(Requisicion.updateMany(FILTER, update, opts).exec(), (e) => e.statusCode === 409);
      await assert.rejects(Requisicion.findOneAndUpdate(FILTER, update, opts).exec(), (e) => e.statusCode === 409);
    });
  }

  it('a confirmation is refused unless the array filters pin ONE reception, ONE item and "no confirmation yet"', () => {
    const update = () => ({ $set: { [CP]: CONF() } });
    const bad = {
      'no array filters': undefined,
      'empty array filters': [],
      'only the reception filter': [{ 'rec.recepcionId': rid }],
      'only the item filter': [{ 'itm.lineaId': lid, 'itm.confirmacion': { $exists: false } }],
      'item filter without the write-once guard': [{ 'rec.recepcionId': rid }, { 'itm.lineaId': lid }],
      'item filter with $exists:true': [{ 'rec.recepcionId': rid }, { 'itm.lineaId': lid, 'itm.confirmacion': { $exists: true } }],
      'item filter without lineaId': [{ 'rec.recepcionId': rid }, { 'itm.confirmacion': { $exists: false } }],
      'reception filter with an operator': [{ 'rec.recepcionId': { $exists: true } }, { 'itm.lineaId': lid, 'itm.confirmacion': { $exists: false } }],
      'reception filter without recepcionId': [{ 'rec.fecha': new Date() }, { 'itm.lineaId': lid, 'itm.confirmacion': { $exists: false } }],
      'lineaId matched by an operator': [{ 'rec.recepcionId': rid }, { 'itm.lineaId': { $ne: lid }, 'itm.confirmacion': { $exists: false } }],
      'guard with extra operators': [{ 'rec.recepcionId': rid }, { 'itm.lineaId': lid, 'itm.confirmacion': { $exists: false, $ne: 1 } }],
    };
    for (const [name, arrayFilters] of Object.entries(bad)) {
      const err = findForbiddenRequisicionUpdate(update(), arrayFilters === undefined ? {} : { arrayFilters });
      assert.equal(err?.code, 'RECEPCIONES_INMUTABLES', name);
    }
  });

  it('the confirmation object is strict: allowed keys, valid result, a user, a plain object', () => {
    const opts = { arrayFilters: AF };
    const set = (v) => ({ $set: { [CP]: v } });
    assert.equal(findForbiddenRequisicionUpdate(set(CONF()), opts), null);
    assert.equal(findForbiddenRequisicionUpdate(set({ por: oid(), resultado: 'No_Llego' }), opts), null);
    for (const v of [
      { ...CONF(), extra: 1 },
      { ...CONF(), resultado: 'Otro' },
      { fecha: new Date(), resultado: 'Recibido' },
      { por: oid(), fecha: new Date() },
      { ...CONF(), $set: { x: 1 } },
      [],
      null,
      'Recibido',
      {},
    ]) {
      assert.equal(findForbiddenRequisicionUpdate(set(v), opts)?.code, 'RECEPCIONES_INMUTABLES', JSON.stringify(v));
    }
  });

  it('two confirmations in the same write are refused', () => {
    const update = {
      $set: {
        [CP]: CONF(),
        'recepciones.$[rec2].items.$[itm2].confirmacion': CONF(),
      },
    };
    const arrayFilters = [...AF, { 'rec2.recepcionId': oid() }, { 'itm2.lineaId': oid(), 'itm2.confirmacion': { $exists: false } }];
    assert.equal(findForbiddenRequisicionUpdate(update, { arrayFilters })?.code, 'RECEPCIONES_INMUTABLES');
  });

  it('rejects bulkWrite replacements, deletes and forbidden updates; confirmations in bulkWrite need the array filters too', async () => {
    await rejects(Requisicion.bulkWrite([{ updateOne: { filter: FILTER, update: { $set: { recepciones: [] } } } }]), 'RECEPCIONES_INMUTABLES');
    await rejects(Requisicion.bulkWrite([{ updateMany: { filter: FILTER, update: { $set: { [CP]: CONF() } } } }]), 'RECEPCIONES_INMUTABLES');
    await rejects(Requisicion.bulkWrite([{ replaceOne: { filter: FILTER, replacement: base() } }]), 'TIMELINE_INMUTABLE');
    await rejects(Requisicion.replaceOne(FILTER, base()).exec(), 'TIMELINE_INMUTABLE');
  });

  it('save() on an existing document with modified receptions is rejected; a new document may carry them', async () => {
    const fresh = new Requisicion(base({ recepciones: [recepcion()] }));
    await fresh.validate();
    const persisted = new Requisicion(base());
    persisted.isNew = false;
    persisted.recepciones.push(recepcion());
    await rejects(persisted.save({ validateBeforeSave: false }), 'RECEPCIONES_INMUTABLES');
  });

  it('appendEvent: pushRecepciones travels in the same write, requires room under the cap, and passes the guards', async () => {
    const calls = [];
    const original = Requisicion.findOneAndUpdate;
    Requisicion.findOneAndUpdate = (filter, update, options) => { calls.push({ filter, update, options }); return Promise.resolve({ ok: true }); };
    try {
      const r = recepcion();
      await Requisicion.appendEvent({ ...FILTER, estado: 'Aprobada' }, [event()], {
        set: { estado: 'En_Recepcion', 'lineas.$[lin].estadoLinea': 'Recibida' },
        arrayFilters: [{ 'lin.lineaId': lid }],
        pushRecepciones: r,
      });
      assert.equal(calls.length, 1, 'one write');
      const { filter, update, options } = calls[0];
      assert.deepEqual(update.$push.recepciones, { $each: [r] });
      assert.ok(update.$push.timeline);
      assert.ok(filter.$and.some((c) => c[`recepciones.${RECEPCIONES_SOFT_CAP - 1}`]?.$exists === false), 'cap guard in the filter');
      assert.equal(filter.$and[0].estado, 'Aprobada');
      assert.equal(findForbiddenRequisicionUpdate(update, options), null);
    } finally {
      Requisicion.findOneAndUpdate = original;
    }
  });

  it('appendEvent: confirmarItem builds the single guarded $set, the array filters and the "not confirmed yet" filter', async () => {
    const calls = [];
    const original = Requisicion.findOneAndUpdate;
    Requisicion.findOneAndUpdate = (filter, update, options) => { calls.push({ filter, update, options }); return Promise.resolve({ ok: true }); };
    try {
      const confirmacion = CONF();
      await Requisicion.appendEvent({ ...FILTER, estado: 'En_Recepcion' }, [event()], {
        confirmarItem: { recepcionId: String(rid), lineaId: String(lid), confirmacion },
        set: { 'lineas.$[lin].estadoLinea': 'Confirmada' },
        arrayFilters: [{ 'lin.lineaId': lid }],
      });
      const { filter, update, options } = calls[0];
      assert.deepEqual(update.$set[CP], confirmacion);
      assert.equal(options.arrayFilters.length, 3);
      const itemFilter = options.arrayFilters.find((f) => 'itm.lineaId' in f);
      assert.deepEqual(itemFilter['itm.confirmacion'], { $exists: false });
      const elem = filter.$and.find((c) => c.recepciones)?.recepciones.$elemMatch;
      assert.equal(String(elem.recepcionId), String(rid));
      assert.deepEqual(elem.items.$elemMatch.confirmacion, { $exists: false });
      assert.equal(findForbiddenRequisicionUpdate(update, options), null);
    } finally {
      Requisicion.findOneAndUpdate = original;
    }
  });
});
