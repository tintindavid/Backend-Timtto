/**
 * Adversarial round 2, 3.1: a stale requisition document must never regress a newer solicitud summary.
 * DB-free (in-memory Repuestos evaluated with sift).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import sift from 'sift';

import { Repuestos } from '../../src/models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../../src/models/repuestotrazabilidad.model.js';
import { syncRequisicionSolicitudes } from '../../src/services/requisicionSolicitudSync.service.js';

const oid = () => new mongoose.Types.ObjectId();
const T = 'acme';
let rows;
const saved = {};

beforeEach(() => {
  rows = [];
  Object.assign(saved, { find: Repuestos.find, updateOne: Repuestos.updateOne, trace: RepuestoTrazabilidad.create });
  Repuestos.find = (f) => ({ lean: async () => rows.filter((r) => sift(f)(r)).map((r) => ({ ...r, requisicion: r.requisicion && { ...r.requisicion } })) });
  Repuestos.updateOne = async (f, u) => {
    const hit = rows.find((r) => sift(f)(r));
    if (!hit) return { modifiedCount: 0 };
    for (const [p, v] of Object.entries(u.$set || {})) hit.requisicion[p.split('.')[1]] = v;
    return { modifiedCount: 1 };
  };
  RepuestoTrazabilidad.create = async (d) => d;
});
afterEach(() => { Repuestos.find = saved.find; Repuestos.updateOne = saved.updateOne; RepuestoTrazabilidad.create = saved.trace; });

function setup(current) {
  const s = { _id: oid(), tenantId: T, nombre: 'Sensor', EstadoSolicitud: 'Solicitado' };
  const l = { lineaId: oid(), origenSolicitudRepuestoId: s._id, estadoLinea: 'Pendiente', cantidadConfirmada: 0, cantidadSolicitada: 4 };
  const r = { _id: oid(), consecutivo: 'REQ-1', estado: 'En_Recepcion', lineas: [l] };
  s.requisicion = { requisicionId: r._id, lineaId: l.lineaId, consecutivo: r.consecutivo, ...current };
  rows.push(s);
  return { s, l, r };
}

describe('sync never regresses a newer summary (3.1)', () => {
  it('a stale document (line Recibida, c=0) does not undo Disponible c=2', async () => {
    const { l, r } = setup({ disponibilidad: 'Disponible', cantidadConfirmada: 2 });
    l.estadoLinea = 'Recibida';
    const out = await syncRequisicionSolicitudes(T, r);
    assert.deepEqual(out.updated, []);
    assert.equal(rows[0].requisicion.disponibilidad, 'Disponible');
    assert.equal(rows[0].requisicion.cantidadConfirmada, 2);
  });

  it('a stale document with a smaller confirmed quantity does not shrink it', async () => {
    const { l, r } = setup({ disponibilidad: 'Disponible', cantidadConfirmada: 3 });
    l.estadoLinea = 'Confirmada'; l.cantidadConfirmada = 1;
    await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.cantidadConfirmada, 3);
  });

  it('forward progress still applies (En_Abastecimiento -> Recibida -> Disponible)', async () => {
    const { l, r } = setup({ disponibilidad: 'En_Abastecimiento', cantidadConfirmada: 0 });
    l.estadoLinea = 'Recibida';
    await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.disponibilidad, 'Recibida');
    l.estadoLinea = 'Confirmada'; l.cantidadConfirmada = 4;
    await syncRequisicionSolicitudes(T, r);
    assert.equal(rows[0].requisicion.disponibilidad, 'Disponible');
    assert.equal(rows[0].requisicion.cantidadConfirmada, 4);
  });
});
