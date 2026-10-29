/**
 * requisiciones-e2-solicitudes-recepcion, task 2.3 / 2.4: truth table line -> disponibilidad and the sync service.
 * DB-free: Repuestos / RepuestoTrazabilidad are replaced by an in-memory store that evaluates the REAL filters with
 * `sift` (the Mongo matcher Mongoose depends on) and applies `$set` / `$unset` with dotted paths.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import sift from 'sift';

import { Repuestos } from '../../src/models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../../src/models/repuestotrazabilidad.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import {
  UNLINK,
  computeSolicitudTarget,
  releaseSolicitudes,
  syncRequisicionSolicitudes,
  syncRequisicionSolicitudesSafe,
} from '../../src/services/requisicionSolicitudSync.service.js';

const oid = () => new mongoose.Types.ObjectId();
const T = 'acme';

// ------------------------------------------------------------------------------------------------ truth table

const L = (estadoLinea, cantidadConfirmada = 0) => ({ lineaId: oid(), estadoLinea, cantidadConfirmada, cantidadSolicitada: 5 });
const target = (estado, linea, extra = {}) => computeSolicitudTarget({ estado, ...extra }, linea);

describe('computeSolicitudTarget (line -> disponibilidad truth table)', () => {
  const table = [
    // [requisition estado, line estado, confirmed, expected]
    ['Borrador', 'Pendiente', 0, 'En_Requisicion'],
    ['Enviada', 'Pendiente', 0, 'En_Aprobacion'],
    ['En_Aprobacion', 'Pendiente', 0, 'En_Aprobacion'],
    ['Aprobada', 'Pendiente', 0, 'En_Abastecimiento'],
    ['Aprobada', 'Recibida_Parcial', 0, 'En_Abastecimiento'],
    ['En_Recepcion', 'Pendiente', 0, 'En_Abastecimiento'],
    ['En_Recepcion', 'Recibida_Parcial', 2, 'En_Abastecimiento'],
    ['En_Recepcion', 'Recibida', 0, 'Recibida'],
    ['En_Recepcion', 'Confirmada', 5, 'Disponible'],
    ['En_Recepcion', 'Confirmada', 3, 'Disponible'], // closed short with something confirmed
    ['En_Recepcion', 'En_Disputa', 0, 'En_Disputa'],
    ['Cerrada', 'Confirmada', 5, 'Disponible'],
    ['Cancelada', 'Confirmada', 4, 'Disponible'], // the goods exist: a later cancellation does not take them back
    ['Cancelada', 'Recibida_Parcial', 1, 'Disponible'], // A4: confirmed goods are never released, whatever the line state
    ['Cancelada', 'En_Disputa', 2, 'Disponible'],
  ];
  for (const [estado, estadoLinea, conf, expected] of table) {
    it(`${estado} / ${estadoLinea} (confirmed ${conf}) -> ${expected}`, () => {
      const out = target(estado, L(estadoLinea, conf));
      assert.equal(out.disponibilidad, expected);
      assert.equal(out.cantidadConfirmada, ['Disponible', 'En_Abastecimiento', 'En_Disputa', 'Recibida'].includes(expected) ? conf : 0);
    });
  }

  const unlinks = [
    ['Rechazada', 'Pendiente', 0],
    ['Cancelada', 'Pendiente', 0],
    ['Cancelada', 'Recibida', 0],
    ['Cancelada', 'En_Disputa', 0],
    ['Aprobada', 'Cancelada', 0],
    ['En_Recepcion', 'Cancelada', 0],
    ['Borrador', 'Cancelada', 0],
    ['En_Recepcion', 'Confirmada', 0], // confirmed nothing: nothing to make available
  ];
  for (const [estado, estadoLinea, conf] of unlinks) {
    it(`${estado} / ${estadoLinea} (confirmed ${conf}) -> unlink`, () => {
      const out = target(estado, L(estadoLinea, conf));
      assert.equal(out.disponibilidad, UNLINK);
      assert.ok(out.motivo);
    });
  }

  it('a deleted requisition always unlinks, even in Borrador', () => {
    assert.equal(target('Borrador', L('Pendiente'), { isDeleted: true }).disponibilidad, UNLINK);
  });

  it('an unknown state yields no target (the solicitud is left as it is)', () => {
    assert.equal(target('Futuro', L('Pendiente')), null);
  });
});

// ------------------------------------------------------------------------------------------------ sync service

let rows;
let traces;
let calls;
let flagWrites;
const saved = {};

// Like a real query result: a detached copy (ObjectIds and Dates are kept as they are).
function deepCopy(v) {
  if (Array.isArray(v)) return v.map(deepCopy);
  if (v && typeof v === 'object' && !(v instanceof Date) && v._bsontype === undefined) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepCopy(x)]));
  }
  return v;
}

function getPath(o, p) {
  return p.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);
}
function setPath(o, p, v) {
  const keys = p.split('.');
  let cur = o;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (cur[keys[i]] === undefined || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = v;
}

beforeEach(() => {
  rows = [];
  traces = [];
  calls = { find: 0, updateOne: [] };
  Object.assign(saved, { find: Repuestos.find, updateOne: Repuestos.updateOne, updateMany: Repuestos.updateMany, trace: RepuestoTrazabilidad.create, reqUpdateOne: Requisicion.updateOne });
  flagWrites = [];
  Requisicion.updateOne = async (filter, update) => { flagWrites.push({ filter, update }); return { modifiedCount: 1 }; };
  Repuestos.find = (filter) => {
    calls.find += 1;
    return { lean: async () => rows.filter((r) => r.isDeleted !== true).filter((r) => sift(filter)(r)).map(deepCopy) };
  };
  Repuestos.updateOne = async (filter, update) => {
    calls.updateOne.push({ filter, update });
    const hit = rows.find((r) => sift(filter)(r));
    if (!hit) return { modifiedCount: 0 };
    for (const [p, v] of Object.entries(update.$set || {})) setPath(hit, p, v);
    for (const p of Object.keys(update.$unset || {})) delete hit[p];
    return { modifiedCount: 1 };
  };
  Repuestos.updateMany = async (filter, update) => {
    let n = 0;
    for (const r of rows.filter((x) => sift(filter)(x))) {
      for (const p of Object.keys(update.$unset || {})) delete r[p];
      n += 1;
    }
    return { modifiedCount: n };
  };
  RepuestoTrazabilidad.create = async (doc) => { traces.push(doc); return doc; };
});

afterEach(() => {
  Repuestos.find = saved.find;
  Repuestos.updateOne = saved.updateOne;
  Repuestos.updateMany = saved.updateMany;
  RepuestoTrazabilidad.create = saved.trace;
  Requisicion.updateOne = saved.reqUpdateOne;
});

const sol = (over = {}) => ({ _id: oid(), tenantId: T, nombre: 'Sensor', Cantidad: '2', EstadoSolicitud: 'Solicitado', ...over });
const req = (over = {}) => ({ _id: oid(), consecutivo: 'REQ-2026-0001', estado: 'Borrador', lineas: [], ...over });
const lineFor = (s, over = {}) => ({ lineaId: oid(), origenSolicitudRepuestoId: s._id, estadoLinea: 'Pendiente', cantidadConfirmada: 0, cantidadSolicitada: 2, ...over });
const linked = (r, l, disponibilidad, extra = {}) => ({ requisicionId: r._id, lineaId: l.lineaId, consecutivo: r.consecutivo, disponibilidad, cantidadConfirmada: 0, ...extra });

describe('syncRequisicionSolicitudes', () => {
  it('a requisition without spare-part lines never touches Repuestos', async () => {
    const out = await syncRequisicionSolicitudes(T, req({ lineas: [{ lineaId: oid(), estadoLinea: 'Pendiente' }] }));
    assert.deepEqual(out, { linked: [], updated: [], unlinked: [] });
    assert.equal(calls.find, 0);
    assert.equal(calls.updateOne.length, 0);
  });

  it('send -> approve: En_Requisicion -> En_Aprobacion -> En_Abastecimiento, one trace per change, EstadoSolicitud untouched', async () => {
    const s = sol();
    const r = req();
    const l = lineFor(s);
    r.lineas = [l];
    s.requisicion = linked(r, l, 'En_Requisicion');
    rows.push(s);

    r.estado = 'En_Aprobacion';
    let out = await syncRequisicionSolicitudes(T, r);
    assert.deepEqual(out.updated, [String(s._id)]);
    assert.equal(rows[0].requisicion.disponibilidad, 'En_Aprobacion');

    r.estado = 'Aprobada';
    out = await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.disponibilidad, 'En_Abastecimiento');

    assert.equal(rows[0].EstadoSolicitud, 'Solicitado');
    assert.equal(traces.length, 2);
    assert.ok(traces[0].Comentarios.startsWith('Requisición REQ-2026-0001: '));
    assert.match(traces[0].Comentarios, /aprobación/);
    assert.match(traces[1].Comentarios, /abastecimiento/);
    for (const t of traces) { assert.equal(t.tenantId, T); assert.equal(t.Status, 'Solicitado'); assert.equal(t.EstadoAnterior, t.EstadoNuevo); }
    for (const c of calls.updateOne) assert.ok(!JSON.stringify(c.update).includes('EstadoSolicitud'), 'never writes EstadoSolicitud');
  });

  it('withdraw: En_Aprobacion -> Borrador sets En_Requisicion again', async () => {
    const s = sol();
    const r = req({ estado: 'Borrador' });
    const l = lineFor(s);
    r.lineas = [l];
    s.requisicion = linked(r, l, 'En_Aprobacion');
    rows.push(s);
    await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.disponibilidad, 'En_Requisicion');
  });

  it('regression: a requisition in the populated public shape (origin as { _id, nombre }) keeps its solicitud linked (no orphan release)', async () => {
    const s = sol();
    const r = req({ estado: 'Borrador' });
    const l = lineFor(s);
    r.lineas = [{ ...l, origenSolicitudRepuestoId: { _id: s._id, nombre: s.nombre, ResponsableSolicitud: null } }];
    s.requisicion = linked(r, l, 'En_Requisicion');
    rows.push(s);
    const out = await syncRequisicionSolicitudes(T, r);
    assert.deepEqual(out.unlinked, []);
    assert.equal(rows[0].requisicion.requisicionId, r._id);
    assert.equal(rows[0].requisicion.disponibilidad, 'En_Requisicion');
    // and it re-claims/updates through the same shape
    r.estado = 'En_Aprobacion';
    await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.disponibilidad, 'En_Aprobacion');
  });

  it('is idempotent: a second run writes nothing and adds no trace', async () => {
    const s = sol();
    const r = req({ estado: 'Aprobada' });
    const l = lineFor(s);
    r.lineas = [l];
    s.requisicion = linked(r, l, 'En_Aprobacion');
    rows.push(s);
    await syncRequisicionSolicitudes(T, r);
    const writes = calls.updateOne.length;
    const tr = traces.length;
    const again = await syncRequisicionSolicitudes(T, r);
    assert.deepEqual(again, { linked: [], updated: [], unlinked: [] });
    assert.equal(calls.updateOne.length, writes);
    assert.equal(traces.length, tr);
  });

  it('reject / cancel unlink the solicitud (selectable again) and trace why', async () => {
    for (const estado of ['Rechazada', 'Cancelada']) {
      rows.length = 0;
      traces.length = 0;
      const s = sol();
      const r = req({ estado });
      const l = lineFor(s);
      r.lineas = [l];
      s.requisicion = linked(r, l, 'En_Aprobacion');
      rows.push(s);
      const out = await syncRequisicionSolicitudes(T, r);
      assert.deepEqual(out.unlinked, [String(s._id)]);
      assert.equal('requisicion' in rows[0], false, estado);
      assert.equal(rows[0].EstadoSolicitud, 'Solicitado');
      assert.equal(traces.length, 1);
      assert.match(traces[0].Comentarios, new RegExp(estado === 'Rechazada' ? 'rechazada' : 'cancelada'));
    }
  });

  it('cancelling an En_Recepcion requisition releases the pending lines but keeps the confirmed one Disponible', async () => {
    const a = sol();
    const b = sol();
    const r = req({ estado: 'Cancelada' });
    const la = lineFor(a, { estadoLinea: 'Confirmada', cantidadConfirmada: 2 });
    const lb = lineFor(b, { estadoLinea: 'Recibida_Parcial' });
    r.lineas = [la, lb];
    a.requisicion = linked(r, la, 'Disponible', { cantidadConfirmada: 2 });
    b.requisicion = linked(r, lb, 'En_Abastecimiento');
    rows.push(a, b);
    await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.disponibilidad, 'Disponible');
    assert.equal('requisicion' in rows[1], false);
  });

  it('reception epic hook: Recibida, then Disponible with the confirmed quantity, then En_Disputa', async () => {
    const s = sol();
    const r = req({ estado: 'En_Recepcion' });
    const l = lineFor(s, { estadoLinea: 'Recibida' });
    r.lineas = [l];
    s.requisicion = linked(r, l, 'En_Abastecimiento');
    rows.push(s);
    await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.disponibilidad, 'Recibida');
    Object.assign(l, { estadoLinea: 'Confirmada', cantidadConfirmada: 2 });
    await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.disponibilidad, 'Disponible');
    assert.equal(rows[0].requisicion.cantidadConfirmada, 2);
    Object.assign(l, { estadoLinea: 'En_Disputa', cantidadConfirmada: 0 });
    await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.disponibilidad, 'En_Disputa');
  });

  it('a reopened requisition re-claims its free solicitud, but never one linked to ANOTHER requisition', async () => {
    const free = sol();
    const taken = sol();
    const other = req({ consecutivo: 'REQ-2026-0002', estado: 'En_Aprobacion' });
    const r = req({ estado: 'Borrador' });
    const lf = lineFor(free);
    const lt = lineFor(taken);
    r.lineas = [lf, lt];
    taken.requisicion = { requisicionId: other._id, lineaId: oid(), consecutivo: other.consecutivo, disponibilidad: 'En_Aprobacion' };
    rows.push(free, taken);
    const out = await syncRequisicionSolicitudes(T, r);
    assert.deepEqual(out.linked, [String(free._id)]);
    assert.equal(String(rows[0].requisicion.requisicionId), String(r._id));
    assert.equal(rows[0].requisicion.disponibilidad, 'En_Requisicion');
    assert.equal(String(rows[1].requisicion.requisicionId), String(other._id), 'the other link is untouched');
  });

  it('does not re-claim a solicitud that is no longer Solicitado', async () => {
    const s = sol({ EstadoSolicitud: 'En Proceso' });
    const r = req();
    r.lineas = [lineFor(s)];
    rows.push(s);
    const out = await syncRequisicionSolicitudes(T, r);
    assert.deepEqual(out.linked, []);
    assert.equal('requisicion' in rows[0], false);
  });

  it('orphans: a solicitud linked to the requisition whose line was removed is released', async () => {
    const kept = sol();
    const orphan = sol();
    const r = req();
    const lk = lineFor(kept);
    r.lineas = [lk];
    kept.requisicion = linked(r, lk, 'En_Requisicion');
    orphan.requisicion = { requisicionId: r._id, lineaId: oid(), consecutivo: r.consecutivo, disponibilidad: 'En_Requisicion' };
    rows.push(kept, orphan);
    const out = await syncRequisicionSolicitudes(T, r);
    assert.deepEqual(out.unlinked, [String(orphan._id)]);
    assert.equal('requisicion' in rows[1], false);
    assert.ok(rows[0].requisicion);
    assert.match(traces[0].Comentarios, /retirada/);
  });

  it('checkOrphans releases the solicitudes of a draft whose spare-part lines were all removed or that was deleted', async () => {
    const s = sol();
    const r = req({ isDeleted: true });
    s.requisicion = { requisicionId: r._id, lineaId: oid(), consecutivo: r.consecutivo, disponibilidad: 'En_Requisicion' };
    rows.push(s);
    const out = await syncRequisicionSolicitudes(T, r, { checkOrphans: true });
    assert.deepEqual(out.unlinked, [String(s._id)]);
  });

  it('tenant isolation: another tenant\'s solicitud is never read or written', async () => {
    const mine = sol();
    const foreign = sol({ tenantId: 'other' });
    const r = req({ estado: 'Rechazada' });
    const lm = lineFor(mine);
    const lf = lineFor(foreign);
    r.lineas = [lm, lf];
    mine.requisicion = linked(r, lm, 'En_Aprobacion');
    foreign.requisicion = linked(r, lf, 'En_Aprobacion');
    rows.push(mine, foreign);
    await syncRequisicionSolicitudes(T, r);
    assert.equal('requisicion' in rows[0], false);
    assert.ok(rows[1].requisicion, 'the foreign tenant keeps its link');
    for (const c of calls.updateOne) assert.equal(c.filter.tenantId, T);
  });

  it('a deleted solicitud is skipped without error', async () => {
    const s = sol({ isDeleted: true });
    const r = req();
    r.lineas = [lineFor(s)];
    rows.push(s);
    assert.deepEqual(await syncRequisicionSolicitudes(T, r), { linked: [], updated: [], unlinked: [] });
  });

  it('the safe wrapper swallows failures (the transition is already committed) and returns null', async () => {
    Repuestos.find = () => { throw new Error('db down'); };
    const s = sol();
    const r = req();
    r.lineas = [lineFor(s)];
    assert.equal(await syncRequisicionSolicitudesSafe(T, r), null);
  });

  it('A6c: a failed sync is observable: flags the requisition (solicitudesSyncPendiente) so the reconcile script finds it', async () => {
    Repuestos.find = () => { throw new Error('db down'); };
    const s = sol();
    const r = req();
    r.lineas = [lineFor(s)];
    assert.equal(await syncRequisicionSolicitudesSafe(T, r), null);
    assert.equal(flagWrites.length, 1);
    assert.deepEqual(flagWrites[0].filter, { _id: String(r._id), tenantId: T });
    assert.deepEqual(flagWrites[0].update, { $set: { solicitudesSyncPendiente: true } });
  });

  it('A6c: a later successful sync clears the flag', async () => {
    const s = sol();
    const r = req({ solicitudesSyncPendiente: true });
    r.lineas = [lineFor(s)];
    rows.push(s);
    assert.ok(await syncRequisicionSolicitudesSafe(T, r));
    assert.deepEqual(flagWrites[0].update, { $unset: { solicitudesSyncPendiente: 1 } });
  });

  it('releaseSolicitudes frees everything still linked to a requisition', async () => {
    const r = req();
    const a = sol({ requisicion: { requisicionId: r._id, disponibilidad: 'En_Requisicion' } });
    const b = sol({ requisicion: { requisicionId: oid(), disponibilidad: 'En_Requisicion' } });
    rows.push(a, b);
    Repuestos.find = (f) => ({ lean: async () => rows.filter((x) => sift(f)(x)) });
    const released = await releaseSolicitudes(T, r._id, 'liberada', r.consecutivo);
    assert.deepEqual(released, [String(a._id)]);
    assert.ok(rows[1].requisicion);
    assert.equal(getPath(rows[0], 'requisicion'), undefined);
    assert.equal(traces.length, 1);
  });
});
