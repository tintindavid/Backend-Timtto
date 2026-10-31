/**
 * Adversarial A6(b): reconcileSolicitudes and the reconcile script core. DB-free (in-memory stores evaluated with sift).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import sift from 'sift';

import { Repuestos } from '../../src/models/repuestos.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { RepuestoTrazabilidad } from '../../src/models/repuestotrazabilidad.model.js';
import { InventarioMovimiento } from '../../src/models/inventarioMovimiento.model.js';
import { reconcileSolicitudes } from '../../src/services/requisicionSolicitudSync.service.js';
import { reconcileRequisicionSolicitudes } from '../../scripts/reconcile-requisicion-solicitudes.js';

const oid = () => new mongoose.Types.ObjectId();
const T = 'acme';
const OLD = new Date(0);

let sols;
let reqs;
let traces;
let pair;
const saved = {};

function setPath(o, p, v) {
  const k = p.split('.');
  let cur = o;
  for (let i = 0; i < k.length - 1; i += 1) { cur[k[i]] ??= {}; cur = cur[k[i]]; }
  cur[k[k.length - 1]] = v;
}

beforeEach(() => {
  sols = [];
  reqs = [];
  traces = [];
  pair = false;
  Object.assign(saved, {
    sFind: Repuestos.find, sUpdate: Repuestos.updateOne, rFind: Requisicion.find, rUpdate: Requisicion.updateOne,
    trace: RepuestoTrazabilidad.create, mov: InventarioMovimiento.findOne, sDistinct: Repuestos.distinct, rDistinct: Requisicion.distinct,
  });
  Repuestos.find = (f) => ({ lean: async () => sols.filter((s) => s.isDeleted !== true).filter((s) => sift(f)(s)).map((s) => ({ ...s })) });
  Repuestos.updateOne = async (f, u) => {
    const hit = sols.find((s) => sift(f)(s));
    if (!hit) return { modifiedCount: 0 };
    for (const [p, v] of Object.entries(u.$set || {})) setPath(hit, p, v);
    for (const p of Object.keys(u.$unset || {})) delete hit[p];
    return { modifiedCount: 1 };
  };
  Requisicion.find = (f) => ({
    lean: async () => reqs.filter((r) => (f.tenantId ? r.tenantId === f.tenantId : true)
      && (f._id?.$in ? f._id.$in.map(String).includes(String(r._id)) : true)
      && (f.solicitudesSyncPendiente ? r.solicitudesSyncPendiente === true : true)),
  });
  Requisicion.updateOne = async (f, u) => {
    const hit = reqs.find((r) => String(r._id) === String(f._id));
    if (!hit) return { modifiedCount: 0 };
    if (u.$unset) delete hit.solicitudesSyncPendiente;
    if (u.$set) hit.solicitudesSyncPendiente = true;
    return { modifiedCount: 1 };
  };
  RepuestoTrazabilidad.create = async (d) => { traces.push(d.Comentarios); return d; };
  InventarioMovimiento.findOne = () => ({ select: () => ({ lean: async () => (pair ? { _id: 'm' } : null) }) });
  Repuestos.distinct = async () => [...new Set(sols.filter((s) => s.requisicion?.requisicionId).map((s) => s.tenantId))];
  Requisicion.distinct = async () => [...new Set(reqs.filter((r) => r.solicitudesSyncPendiente).map((r) => r.tenantId))];
});
afterEach(() => {
  Repuestos.find = saved.sFind; Repuestos.updateOne = saved.sUpdate; Requisicion.find = saved.rFind; Requisicion.updateOne = saved.rUpdate;
  RepuestoTrazabilidad.create = saved.trace; InventarioMovimiento.findOne = saved.mov; Repuestos.distinct = saved.sDistinct; Requisicion.distinct = saved.rDistinct;
});


const mkReq = (over = {}) => ({ _id: oid(), tenantId: T, consecutivo: 'REQ-1', estado: 'Aprobada', lineas: [], ...over });
const mkSol = (r, linea, disponibilidad, over = {}) => ({
  _id: linea.origenSolicitudRepuestoId, tenantId: T, EstadoSolicitud: 'Solicitado', updatedAt: OLD,
  requisicion: { requisicionId: r._id, lineaId: linea.lineaId, consecutivo: r.consecutivo, disponibilidad, cantidadConfirmada: 0 }, ...over,
});
const mkLine = (over = {}) => ({ lineaId: oid(), origenSolicitudRepuestoId: oid(), estadoLinea: 'Pendiente', cantidadConfirmada: 0, ...over });

describe('reconcileSolicitudes', () => {
  it('releases the stale cases and reports counts per case; a second run changes nothing (idempotent)', async () => {
    const cancelled = mkReq({ estado: 'Cancelada' });
    const lc = mkLine(); cancelled.lineas = [lc];
    const rejected = mkReq({ estado: 'Rechazada' });
    const lr = mkLine(); rejected.lineas = [lr];
    const alive = mkReq({ estado: 'Aprobada' });
    const la = mkLine(); alive.lineas = [la];
    const driftLine = mkLine({ estadoLinea: 'Recibida' });
    alive.lineas.push(driftLine);
    const orphanLine = mkLine();
    reqs.push(cancelled, rejected, alive);
    sols.push(mkSol(cancelled, lc, 'En_Abastecimiento'), mkSol(rejected, lr, 'En_Aprobacion'));
    sols.push(mkSol(alive, la, 'En_Abastecimiento'));
    sols.push(mkSol(alive, driftLine, 'En_Abastecimiento')); // should be Recibida
    sols.push(mkSol(alive, orphanLine, 'En_Abastecimiento')); // alive has no line for it
    const ghost = { requisicionId: oid(), disponibilidad: 'En_Requisicion' };
    sols.push({ _id: oid(), tenantId: T, EstadoSolicitud: 'Solicitado', updatedAt: OLD, requisicion: ghost });
    sols.push({ _id: oid(), tenantId: T, EstadoSolicitud: 'Solicitado', updatedAt: new Date(), requisicion: { requisicionId: oid(), disponibilidad: 'En_Requisicion' } }); // young claim

    const dry = await reconcileSolicitudes(T, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(sols.filter((s) => s.requisicion).length, 7, 'dry run writes nothing');
    assert.equal(traces.length, 0);

    const out = await reconcileSolicitudes(T);
    assert.equal(out.reclamadasSinRequisicion, 1);
    assert.equal(out.omitidasPorGracia, 1);
    assert.equal(out.enlacesObsoletos, 2);
    assert.equal(out.lineasRetiradas, 1);
    assert.equal(out.actualizadas, 1);
    assert.equal(sols.filter((s) => s.requisicion).length, 3); // alive + drift + young claim
    assert.ok(traces.every((c) => c.startsWith('Requisición')));

    const again = await reconcileSolicitudes(T);
    assert.equal(again.reclamadasSinRequisicion + again.enlacesObsoletos + again.lineasRetiradas + again.actualizadas, 0);
  });

  it('a Cancelada requisition keeps the link of a line with confirmed goods', async () => {
    const r = mkReq({ estado: 'Cancelada' });
    const l = mkLine({ estadoLinea: 'Confirmada', cantidadConfirmada: 2 }); r.lineas = [l];
    reqs.push(r);
    sols.push(mkSol(r, l, 'Disponible'));
    sols[0].requisicion.cantidadConfirmada = 2;
    const out = await reconcileSolicitudes(T);
    assert.equal(out.enlacesObsoletos, 0);
    assert.ok(sols[0].requisicion);
  });

  it('a stock marker blocks the unlink when a stock pair was posted, and is cleared with the link otherwise', async () => {
    const r = mkReq({ estado: 'Rechazada' });
    const l = mkLine({ inventarioItemId: oid() }); r.lineas = [l];
    reqs.push(r);
    sols.push(mkSol(r, l, 'En_Aprobacion', { stockDescontadoPor: 'requisicion' }));
    pair = true;
    let out = await reconcileSolicitudes(T);
    assert.equal(out.conservadasPorStock, 1);
    assert.ok(sols[0].requisicion);
    pair = false;
    out = await reconcileSolicitudes(T);
    assert.equal(sols[0].requisicion, undefined);
    assert.equal(sols[0].stockDescontadoPor, undefined);
  });

  it('a requisition flagged by a failed sync is found and its flag cleared (even with no solicitud linked)', async () => {
    const r = mkReq({ estado: 'Aprobada', solicitudesSyncPendiente: true });
    reqs.push(r);
    const out = await reconcileSolicitudes(T);
    assert.equal(out.requisicionesMarcadas, 1);
    assert.equal(out.marcasLimpiadas, 1);
    assert.equal(r.solicitudesSyncPendiente, undefined);
  });

  it('requires a tenant', async () => {
    await assert.rejects(() => reconcileSolicitudes(undefined), /TenantId is required/);
  });
});

describe('reconcile script core', () => {
  it('walks every tenant with links (or only --tenant) and totals the counts', async () => {
    const r = mkReq({ estado: 'Cancelada' });
    const l = mkLine(); r.lineas = [l];
    reqs.push(r);
    sols.push(mkSol(r, l, 'En_Abastecimiento'));
    const dry = await reconcileRequisicionSolicitudes({ dryRun: true });
    assert.equal(dry.tenants, 1);
    assert.equal(dry.totals.enlacesObsoletos, 1);
    assert.ok(sols[0].requisicion);
    const real = await reconcileRequisicionSolicitudes({ tenantId: T });
    assert.equal(real.totals.enlacesObsoletos, 1);
    assert.equal(sols[0].requisicion, undefined);
    assert.equal((await reconcileRequisicionSolicitudes({})).totals.enlacesObsoletos, 0);
  });
});
