/**
 * Requisiciones E2 (solicitudes de repuestos + sincronizacion + bloqueos + OT) against a REAL MongoDB (node:test).
 * SKIPPED unless MONGO_INTEGRATION_URI is set, so `npm test` never needs a database. Unit suites use fakes; this file
 * exercises what they cannot: the conditional claim of solicitudes under concurrency, real `$elemMatch` / array
 * filters of the reception writes, the immutability hooks on real updates, the real backfill filter and the OT
 * completion with stock.
 *
 * HOW TO RUN (throwaway local instance only; the test creates and DROPS its own database `req_e2_<random>`):
 *
 *   mongod --dbpath <new empty dir> --port 27631 --bind_ip 127.0.0.1        # standalone, no replica set
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27631 \
 *     node --test tests/integration/requisicion.e2.mongo.integration.test.js
 *
 * NEVER point it at a shared / remote / production database. Notifications are stubbed (notificationService.emit).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion, buildTimelineEvent } from '../../src/models/requisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../../src/models/repuestotrazabilidad.model.js';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Report } from '../../src/models/report.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { requisicionService } from '../../src/services/requisicion.service.js';
import { requisicionApprovalService } from '../../src/services/requisicionApproval.service.js';
import { repuestoRequisicionService } from '../../src/services/repuestoRequisicion.service.js';
import { repuestosService } from '../../src/services/repuestos.service.js';
import { syncRequisicionSolicitudes } from '../../src/services/requisicionSolicitudSync.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { areaService } from '../../src/services/area.service.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { reglaAprobacionService } from '../../src/services/reglaAprobacion.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { oTService } from '../../src/services/ot.service.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { backfillRequisicionesReceive, RECEIVE_PERMISSION } from '../../scripts/2026-10-27-backfill-requisiciones-receive.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
// Write/read responses populate lineas[].origenSolicitudRepuestoId as { _id, nombre, ResponsableSolicitud }.
const sid = (v) => String(v?._id ?? v);
const CAPS = { usesRequisiciones: true };
const CAPS_STOCK = { usesRequisiciones: true, usesInventoryBasic: true, usesInventoryAdvanced: true };

async function expectApi(promise, statusCode, code) {
  let err;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, `expected rejection ${statusCode} ${code || ''}`);
  assert.equal(err.statusCode, statusCode, `status: ${err.statusCode} ${err.code} ${err.message}`);
  if (code) assert.equal(err.code, code);
  return err;
}

let userSeq = 0;
async function mkUser(tenantId, extra = {}) {
  userSeq += 1;
  return User.create({ tenantId, email: `u${userSeq}-${rnd()}@t.co`, password: 'x'.repeat(10), fullName: `U${userSeq}`, ...extra });
}

/** A tenant with: tipo, area (2 jefes who can approve), one rule (jefe_area), a creator and a responsible technician. */
async function mkWorld({ withRules = true } = {}) {
  const tenantId = `t-${rnd()}`;
  const creator = await mkUser(tenantId);
  const approverRole = await Role.create({ tenantId, name: `approver-${rnd()}`, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] });
  const jefe1 = await mkUser(tenantId, { roleId: approverRole._id });
  const jefe2 = await mkUser(tenantId, { roleId: approverRole._id });
  const techRole = await Role.create({ tenantId, name: `tech-${rnd()}`, permissions: ['ots:can-be-responsible'] });
  const tech = await mkUser(tenantId, { roleId: techRole._id });
  const tipo = await tipoRequisicionService.create(tenantId, { nombre: 'Repuesto', codigo: 'rep' });
  const area = await areaService.create(tenantId, { nombre: 'Biomedica', codigo: 'bio', jefesIds: [sid(jefe1._id), sid(jefe2._id)] });
  if (withRules) await reglaAprobacionService.create(tenantId, { orden: 1, nombre: 'Jefe', montoDesde: 0, montoHasta: null, aprobadorTipo: 'jefe_area' });
  return { tenantId, creator, jefe1, jefe2, tech, tipo, area };
}

const actor = (u) => ({ userId: sid(u._id), name: 'x' });

let solSeq = 0;
function mkSol(tenantId, over = {}) {
  solSeq += 1;
  return Repuestos.create({
    tenantId,
    nombre: `Sensor ${solSeq}`,
    Cantidad: '2',
    EquipoId: oid(),
    OrdenId: oid(),
    ClienteId: over.ClienteId || oid(),
    ReporteSolicitudId: oid(),
    ResponsableSolicitud: oid(),
    EstadoSolicitud: 'Solicitado',
    ...over,
  });
}

const rawSol = (id) => Repuestos.collection.findOne({ _id: new mongoose.Types.ObjectId(sid(id)) });
const rawReq = (id) => Requisicion.collection.findOne({ _id: new mongoose.Types.ObjectId(sid(id)) });
const link = async (id) => (await rawSol(id))?.requisicion;
const traceOf = async (id) => (await RepuestoTrazabilidad.collection.find({ SolicitudRepuestoId: new mongoose.Types.ObjectId(sid(id)) }).sort({ createdAt: 1 }).toArray()).map((t) => t.Comentarios);
const countReqs = (tenantId) => Requisicion.collection.countDocuments({ tenantId, isDeleted: { $ne: true } });

const body = (w, ids, extra = {}) => ({
  repuestoIds: ids.map(sid),
  tipoRequisicionId: sid(w.tipo._id),
  areaId: sid(w.area._id),
  justificacion: 'Se requiere para el servicio',
  ...extra,
});
const create = (w, ids, extra = {}, caps = CAPS, who = w.creator) => repuestoRequisicionService.createFromSolicitudes(w.tenantId, actor(who), body(w, ids, extra), caps);
const versionOf = async (id) => (await rawReq(id))?.version ?? 1;
const approve = async (w, id, who = w.jefe1) => requisicionApprovalService.approve(w.tenantId, sid(id), actor(who), { version: await versionOf(id) });
const reject = async (w, id, who = w.jefe1) => requisicionApprovalService.reject(w.tenantId, sid(id), actor(who), { version: await versionOf(id), observacion: 'No procede' });

/** Moves the lines of an approved requisition to a state, the way the reception epic will, then syncs. */
async function setLine(w, reqId, index, patch, estado) {
  const set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`lineas.${index}.${k}`, v]));
  if (estado) set.estado = estado;
  await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(sid(reqId)) }, { $set: set });
  const doc = await Requisicion.findOne({ _id: reqId, tenantId: w.tenantId });
  return syncRequisicionSolicitudes(w.tenantId, doc);
}

describe('Requisiciones E2 on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e2_${rnd()}`;
  let savedEmit;
  let savedEnforce;

  before(async () => {
    // The capability guard must be in enforcing mode (a developer .env may relax it).
    savedEnforce = process.env.ENFORCE_TENANT_CAPABILITIES;
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    await mongoose.connect(URI, { dbName });
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    for (const m of [Requisicion, Area, TipoRequisicion, ReglaAprobacion, Counter, User, Role, Repuestos, RepuestoTrazabilidad, InventarioRepuesto, OT, Report, Tenant]) {
      await m.init();
      await m.syncIndexes();
    }
  });

  after(async () => {
    if (savedEnforce === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES;
    else process.env.ENFORCE_TENANT_CAPABILITIES = savedEnforce;
    notificationService.emit = savedEmit;
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  // ---------------------------------------------------------------------------------------------- creation

  describe('create a requisition from solicitudes', () => {
    it('two solicitudes -> draft with two linked lines; each solicitud En_Requisicion, EstadoSolicitud untouched, traced', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId, { Cantidad: '3', PrecioRepuesto: 50 });
      const b = await mkSol(w.tenantId, { Cantidad: '1' });
      const out = await create(w, [a._id, b._id], { titulo: 'Repuestos del mes' });

      assert.deepEqual(out.advertencias, []);
      const r = out.requisicion;
      assert.equal(r.estado, 'Borrador');
      assert.equal(r.titulo, 'Repuestos del mes');
      assert.equal(r.lineas.length, 2);
      assert.equal(r.areaId.nombre, 'Biomedica', 'same populated shape as GET /requisiciones/:id');
      assert.equal(r.montoEstimado, 150);
      const ids = r.lineas.map((l) => sid(l.origenSolicitudRepuestoId));
      assert.deepEqual(ids, [sid(a._id), sid(b._id)]);
      assert.equal(r.lineas[0].cantidadSolicitada, 3);

      for (const [i, s] of [a, b].entries()) {
        const l = await link(s._id);
        assert.equal(sid(l.requisicionId), sid(r._id));
        assert.equal(sid(l.lineaId), sid(r.lineas[i].lineaId));
        assert.equal(l.consecutivo, r.consecutivo);
        assert.equal(l.disponibilidad, 'En_Requisicion');
        assert.equal((await rawSol(s._id)).EstadoSolicitud, 'Solicitado');
        assert.ok((await traceOf(s._id)).some((c) => c.startsWith(`Requisición ${r.consecutivo}: `)));
      }
      // identical to GET by id
      const again = await requisicionService.getById(w.tenantId, sid(r._id));
      assert.equal(again.consecutivo, r.consecutivo);
      assert.equal(again.lineas.length, 2);
    });

    it('create and send: En_Aprobacion, solicitudes En_Aprobacion', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const b = await mkSol(w.tenantId);
      const { requisicion } = await create(w, [a._id, b._id], { enviar: true });
      assert.equal(requisicion.estado, 'En_Aprobacion');
      for (const s of [a, b]) assert.equal((await link(s._id)).disponibilidad, 'En_Aprobacion');
      assert.equal((await rawSol(a._id)).EstadoSolicitud, 'Solicitado');
    });

    it('non numeric quantity -> line quantity 1 and a warning in the response', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId, { Cantidad: 'un par' });
      const { requisicion, advertencias } = await create(w, [a._id]);
      assert.equal(requisicion.lineas[0].cantidadSolicitada, 1);
      assert.equal(advertencias.length, 1);
      assert.equal(advertencias[0].repuestoId, sid(a._id));
      assert.equal(advertencias[0].campo, 'cantidad');
    });

    it('request overrides (quantity, price, description) win over the solicitud values', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId, { Cantidad: '9', PrecioRepuesto: 10 });
      const { requisicion } = await create(w, [a._id], { lineas: [{ repuestoId: sid(a._id), cantidad: 4, precioEstimado: 25, descripcion: 'Sensor SpO2 adulto' }] });
      assert.equal(requisicion.lineas[0].cantidadSolicitada, 4);
      assert.equal(requisicion.lineas[0].precioEstimado, 25);
      assert.equal(requisicion.lineas[0].descripcion, 'Sensor SpO2 adulto');
      assert.equal(requisicion.montoEstimado, 100);
    });

    it('Stock basico: the line references the stock item and takes its price; without it the line is free text', async () => {
      const w = await mkWorld();
      const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Cable ECG', unidad: 'und', precio: 80 });
      const a = await mkSol(w.tenantId, { InventarioItemId: item._id });
      const { requisicion } = await create(w, [a._id], {}, { usesRequisiciones: true, usesInventoryBasic: true });
      assert.equal(sid(requisicion.lineas[0].inventarioItemId), sid(item._id));
      assert.equal(requisicion.lineas[0].precioEstimado, 80);
      assert.equal(requisicion.lineas[0].snapshot.nombre, 'Cable ECG');

      const b = await mkSol(w.tenantId, { InventarioItemId: item._id });
      const free = await create(w, [b._id], {}, CAPS);
      assert.equal(free.requisicion.lineas[0].inventarioItemId, null);
    });

    it('A2: two solicitudes sharing a stock item -> both lines keep the item (no warning)', async () => {
      const w = await mkWorld();
      const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Electrodo', unidad: 'und', precio: 5 });
      const a = await mkSol(w.tenantId, { InventarioItemId: item._id });
      const b = await mkSol(w.tenantId, { InventarioItemId: item._id });
      const { requisicion, advertencias } = await create(w, [a._id, b._id], {}, { usesRequisiciones: true, usesInventoryBasic: true });
      assert.equal(sid(requisicion.lineas[0].inventarioItemId), sid(item._id));
      assert.equal(sid(requisicion.lineas[1].inventarioItemId), sid(item._id));
      assert.equal(advertencias.filter((x) => x.campo === 'inventarioItemId').length, 0);
    });

    it('already linked -> 409 SOLICITUD_YA_VINCULADA with the ids; nothing is created and the free ones stay free', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const b = await mkSol(w.tenantId);
      await create(w, [a._id]);
      const before = await countReqs(w.tenantId);
      const err = await expectApi(create(w, [a._id, b._id]), 409, 'SOLICITUD_YA_VINCULADA');
      assert.deepEqual(err.details.ids, [sid(a._id)]);
      assert.equal(await countReqs(w.tenantId), before);
      assert.equal(await link(b._id), undefined);
    });

    it('not eligible (not Solicitado), foreign tenant, deleted: nothing is created', async () => {
      const w = await mkWorld();
      const other = await mkWorld();
      const proceso = await mkSol(w.tenantId, { EstadoSolicitud: 'En Proceso' });
      const foreign = await mkSol(other.tenantId);
      const deleted = await mkSol(w.tenantId, { isDeleted: true });
      const ok = await mkSol(w.tenantId);
      await expectApi(create(w, [ok._id, proceso._id]), 400, 'SOLICITUD_NO_ELEGIBLE');
      await expectApi(create(w, [ok._id, foreign._id]), 404, 'SOLICITUD_NOT_FOUND');
      await expectApi(create(w, [ok._id, deleted._id]), 404, 'SOLICITUD_NOT_FOUND');
      assert.equal(await countReqs(w.tenantId), 0);
      assert.equal(await link(ok._id), undefined);
      assert.equal(await link(foreign._id), undefined, 'the foreign solicitud is never touched');
    });

    it('tenant without the module -> 403 CAPABILITY_DISABLED, nothing written', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      await expectApi(create(w, [a._id], {}, { usesRequisiciones: false }), 403, 'CAPABILITY_DISABLED');
      await expectApi(create(w, [a._id], {}, null), 403, 'CAPABILITY_DISABLED');
      assert.equal(await countReqs(w.tenantId), 0);
      assert.equal(await link(a._id), undefined);
    });

    it('invalid type / area: nothing is left claimed', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      await expectApi(create(w, [a._id], { areaId: sid(oid()) }), 400, 'AREA_INVALIDA');
      await expectApi(create(w, [a._id], { tipoRequisicionId: sid(oid()) }), 400, 'TIPO_INVALIDO');
      assert.equal(await link(a._id), undefined);
      assert.equal(await countReqs(w.tenantId), 0);
    });

    it('create and send that fails (no approval rules -> 422) leaves no requisition and no claimed solicitud', async () => {
      const w = await mkWorld({ withRules: false });
      const a = await mkSol(w.tenantId);
      await expectApi(create(w, [a._id], { enviar: true }), 422, 'SIN_REGLAS_APROBACION');
      assert.equal(await countReqs(w.tenantId), 0);
      assert.equal(await link(a._id), undefined);
      // and the solicitud can be used right after
      assert.equal((await create(w, [a._id])).requisicion.estado, 'Borrador');
    });

    it('create and send without a justification is a 400 before anything is claimed', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      await expectApi(create(w, [a._id], { enviar: true, justificacion: '' }), 400, 'JUSTIFICACION_REQUERIDA');
      assert.equal(await link(a._id), undefined);
    });
  });

  // ---------------------------------------------------------------------------------------------- concurrency

  describe('concurrency: two requisitions over the same solicitud', () => {
    it('exactly one wins; the loser creates nothing and the solicitud points at the winner', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => create(w, [a._id])));
      const ok = results.filter((r) => r.status === 'fulfilled');
      const ko = results.filter((r) => r.status === 'rejected');
      assert.equal(ok.length, 1, JSON.stringify(ko.map((k) => k.reason?.code)));
      for (const k of ko) { assert.equal(k.reason.statusCode, 409); assert.equal(k.reason.code, 'SOLICITUD_YA_VINCULADA'); }
      assert.equal(await countReqs(w.tenantId), 1);
      assert.equal(sid((await link(a._id)).requisicionId), sid(ok[0].value.requisicion._id));
    });

    it('overlapping selections: the loser releases what it had claimed', async () => {
      const w = await mkWorld();
      const [s1, s2, s3] = [await mkSol(w.tenantId), await mkSol(w.tenantId), await mkSol(w.tenantId)];
      const [x, y] = await Promise.allSettled([create(w, [s1._id, s2._id]), create(w, [s2._id, s3._id])]);
      const winners = [x, y].filter((r) => r.status === 'fulfilled');
      assert.equal(winners.length, 1);
      const win = winners[0].value.requisicion;
      assert.equal(await countReqs(w.tenantId), 1);
      const linked = [];
      for (const s of [s1, s2, s3]) {
        const l = await link(s._id);
        if (l) { assert.equal(sid(l.requisicionId), sid(win._id)); linked.push(sid(s._id)); }
      }
      assert.deepEqual(linked.sort(), win.lineas.map((l) => sid(l.origenSolicitudRepuestoId)).sort(), 'only the winner\'s solicitudes stay linked');
    });
  });

  // ---------------------------------------------------------------------------------------------- sync across the lifecycle

  describe('link sync across the requisition lifecycle', () => {
    it('send -> withdraw -> send -> approve: En_Aprobacion, En_Requisicion, En_Aprobacion, En_Abastecimiento; one trace per change', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const { requisicion } = await create(w, [a._id]);
      const id = sid(requisicion._id);
      const disp = async () => (await link(a._id)).disponibilidad;

      await requisicionService.enviar(w.tenantId, id, actor(w.creator));
      assert.equal(await disp(), 'En_Aprobacion');
      await requisicionService.retirar(w.tenantId, id, actor(w.creator), { observacion: 'ajustar' });
      assert.equal(await disp(), 'En_Requisicion');
      await requisicionService.enviar(w.tenantId, id, actor(w.creator));
      assert.equal(await disp(), 'En_Aprobacion');
      await approve(w, id);
      assert.equal(await disp(), 'En_Abastecimiento');

      const sol = await rawSol(a._id);
      assert.equal(sol.EstadoSolicitud, 'Solicitado', 'EstadoSolicitud is never touched');
      assert.equal(sol.requisicion.cantidadConfirmada, 0);
      const traces = await traceOf(a._id);
      assert.equal(traces.length, 5, traces.join(' | ')); // included, sent, withdrawn, sent, approved
      assert.ok(traces.every((c) => c.startsWith(`Requisición ${requisicion.consecutivo}: `)));
    });

    it('reject releases the solicitudes (selectable again) with a trace; reopening re-claims them', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const { requisicion } = await create(w, [a._id], { enviar: true });
      const id = sid(requisicion._id);
      await reject(w, id);
      assert.equal(await link(a._id), undefined);
      assert.equal((await rawSol(a._id)).EstadoSolicitud, 'Solicitado');
      assert.ok((await traceOf(a._id)).some((c) => /rechazada/.test(c)));

      await requisicionService.reabrir(w.tenantId, id, actor(w.creator));
      const l = await link(a._id);
      assert.equal(sid(l.requisicionId), id);
      assert.equal(l.disponibilidad, 'En_Requisicion');
    });

    it('a rejected solicitud can go into ANOTHER requisition; reopening the first one does not steal it', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const first = (await create(w, [a._id], { enviar: true })).requisicion;
      await reject(w, sid(first._id));
      const second = (await create(w, [a._id])).requisicion;
      // A3: the only line was taken by the second requisition -> nothing left to reopen
      await expectApi(requisicionService.reabrir(w.tenantId, sid(first._id), actor(w.creator)), 409, 'SIN_LINEAS_VIGENTES');
      assert.equal(sid((await link(a._id)).requisicionId), sid(second._id), 'still linked to the second requisition');
    });

    it('cancel from Borrador, En_Aprobacion and Aprobada releases the solicitudes', async () => {
      const w = await mkWorld();
      for (const stage of ['Borrador', 'En_Aprobacion', 'Aprobada']) {
        const a = await mkSol(w.tenantId);
        const { requisicion } = await create(w, [a._id], { enviar: stage !== 'Borrador' });
        const id = sid(requisicion._id);
        if (stage === 'Aprobada') await approve(w, id);
        await requisicionService.cancelar(w.tenantId, id, actor(w.creator), { motivo: 'ya no se necesita' });
        assert.equal(await link(a._id), undefined, stage);
        assert.ok((await traceOf(a._id)).some((c) => /cancelada/.test(c)), stage);
        // selectable again
        assert.equal((await create(w, [a._id])).requisicion.estado, 'Borrador');
      }
    });

    it('deleting a draft releases the solicitudes; editing the draft to drop a line releases that one only', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const b = await mkSol(w.tenantId);
      const { requisicion } = await create(w, [a._id, b._id]);
      const id = sid(requisicion._id);

      const keep = requisicion.lineas.find((l) => sid(l.origenSolicitudRepuestoId) === sid(a._id));
      await requisicionService.update(w.tenantId, sid(w.creator._id), id, {
        lineas: [{ lineaId: sid(keep.lineaId), cantidadSolicitada: 5, precioEstimado: 1 }],
      }, CAPS);
      assert.equal(sid((await link(a._id)).requisicionId), id);
      assert.equal(await link(b._id), undefined, 'the dropped line released its solicitud');
      const kept = (await rawReq(id)).lineas[0];
      assert.equal(sid(kept.origenSolicitudRepuestoId), sid(a._id), 'the origin of an existing line is preserved by an edit');

      await requisicionService.delete(w.tenantId, id, { userId: sid(w.creator._id) });
      assert.equal(await link(a._id), undefined);
      assert.equal((await create(w, [a._id, b._id])).requisicion.estado, 'Borrador');
    });

    it('a client cannot plant an origin through the public edit (the line is rebuilt without it)', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const victim = await mkSol(w.tenantId);
      const { requisicion } = await create(w, [a._id]);
      await requisicionService.update(w.tenantId, sid(w.creator._id), sid(requisicion._id), {
        lineas: [
          { lineaId: sid(requisicion.lineas[0].lineaId), cantidadSolicitada: 1 },
          { descripcion: 'Otra', unidad: 'und', cantidadSolicitada: 1, origenSolicitudRepuestoId: sid(victim._id) },
        ],
      }, CAPS);
      const lines = (await rawReq(requisicion._id)).lineas;
      assert.equal(lines[1].origenSolicitudRepuestoId ?? null, null);
      assert.equal(await link(victim._id), undefined);
    });

    it('reception states through the sync hook: Recibida, Disponible (with the confirmed quantity), En_Disputa, closed short', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const { requisicion } = await create(w, [a._id], { enviar: true });
      const id = sid(requisicion._id);
      await approve(w, id);

      await setLine(w, id, 0, { estadoLinea: 'Recibida_Parcial', cantidadRecibida: 1 }, 'En_Recepcion');
      assert.equal((await link(a._id)).disponibilidad, 'En_Abastecimiento');
      await setLine(w, id, 0, { estadoLinea: 'Recibida', cantidadRecibida: 2 });
      assert.equal((await link(a._id)).disponibilidad, 'Recibida');
      await setLine(w, id, 0, { estadoLinea: 'En_Disputa' });
      assert.equal((await link(a._id)).disponibilidad, 'En_Disputa');
      await setLine(w, id, 0, { estadoLinea: 'Confirmada', cantidadConfirmada: 1 }); // closed short, 1 of 2 confirmed
      const l = await link(a._id);
      assert.equal(l.disponibilidad, 'Disponible');
      assert.equal(l.cantidadConfirmada, 1);
      // idempotent
      const again = await setLine(w, id, 0, { estadoLinea: 'Confirmada', cantidadConfirmada: 1 });
      assert.deepEqual(again.updated, []);
    });

    it('a cancelled line releases its solicitud even if the requisition is alive', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const b = await mkSol(w.tenantId);
      const { requisicion } = await create(w, [a._id, b._id], { enviar: true });
      await approve(w, sid(requisicion._id));
      await setLine(w, requisicion._id, 1, { estadoLinea: 'Cancelada' }, 'En_Recepcion');
      assert.equal((await link(a._id)).disponibilidad, 'En_Abastecimiento');
      assert.equal(await link(b._id), undefined);
    });

    it('tenant isolation: syncing one tenant never touches another tenant\'s solicitudes', async () => {
      const w = await mkWorld();
      const other = await mkWorld();
      const a = await mkSol(w.tenantId);
      const foreign = await mkSol(other.tenantId);
      const { requisicion } = await create(w, [a._id], { enviar: true });
      // a (corrupt) foreign link pointing at this requisition must be ignored by the sync of w
      await Repuestos.collection.updateOne({ _id: foreign._id }, { $set: { requisicion: { requisicionId: new mongoose.Types.ObjectId(sid(requisicion._id)), disponibilidad: 'En_Aprobacion' } } });
      await requisicionService.cancelar(w.tenantId, sid(requisicion._id), actor(w.creator), { motivo: 'x' });
      assert.equal(await link(a._id), undefined);
      assert.ok(await link(foreign._id), 'the other tenant\'s document is untouched');
    });
  });

  // ---------------------------------------------------------------------------------------------- locks

  describe('locks of Repuestos with the module on', () => {
    it('a linked solicitud cannot be installed, edited or deleted until Disponible', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId, { nombre: 'Sensor X', Cantidad: '2' });
      const { requisicion } = await create(w, [a._id], { enviar: true });
      const id = sid(requisicion._id);
      await approve(w, id);

      for (const data of [{ EstadoSolicitud: 'Instalado' }, { EstadoSolicitud: 'En Proceso' }, { nombre: 'Otro' }, { Cantidad: '9' }]) {
        const err = await expectApi(repuestosService.update(sid(a._id), data, w.tenantId, CAPS), 409, 'SOLICITUD_EN_REQUISICION');
        assert.equal(err.details.disponibilidad, 'En_Abastecimiento');
        assert.equal(err.details.consecutivo, requisicion.consecutivo);
        assert.equal(err.details.requisicionId, id);
      }
      await expectApi(repuestosService.delete(sid(a._id), w.tenantId, CAPS), 409, 'SOLICITUD_EN_REQUISICION');
      const fresh = await rawSol(a._id);
      assert.equal(fresh.EstadoSolicitud, 'Solicitado');
      assert.equal(fresh.nombre, 'Sensor X');
      assert.equal(fresh.isDeleted, false);

      // allowed edits while locked: other fields
      await repuestosService.update(sid(a._id), { observacion: 'nota' }, w.tenantId, CAPS);

      // Disponible -> usual flow
      await setLine(w, id, 0, { estadoLinea: 'Confirmada', cantidadConfirmada: 2 }, 'En_Recepcion');
      const updated = await repuestosService.update(sid(a._id), { EstadoSolicitud: 'Instalado', nombre: 'Sensor X2' }, w.tenantId, CAPS);
      assert.equal(updated.EstadoSolicitud, 'Instalado');
      assert.equal(updated.requisicion.disponibilidad, 'Disponible', 'summary exposed with the module on');
      await repuestosService.delete(sid(a._id), w.tenantId, CAPS);
      assert.equal((await rawSol(a._id)).isDeleted, true);
    });

    it('unlinked solicitudes and tenants without the module keep the previous behaviour', async () => {
      const w = await mkWorld();
      const free = await mkSol(w.tenantId);
      assert.equal((await repuestosService.update(sid(free._id), { EstadoSolicitud: 'Instalado', nombre: 'nuevo' }, w.tenantId, CAPS)).EstadoSolicitud, 'Instalado');

      const linked = await mkSol(w.tenantId);
      await create(w, [linked._id], { enviar: true });
      // module OFF (tenant capability off): a stale link locks nothing and the field is not exposed
      const out = await repuestosService.update(sid(linked._id), { EstadoSolicitud: 'Instalado' }, w.tenantId, { usesRequisiciones: false });
      assert.equal(out.EstadoSolicitud, 'Instalado');
      assert.equal('requisicion' in out, false);
      const other = await mkSol(w.tenantId);
      await create(w, [other._id]);
      await repuestosService.delete(sid(other._id), w.tenantId, { usesRequisiciones: false });
      assert.equal((await rawSol(other._id)).isDeleted, true);
    });

    it('without capabilities in the call, the tenant document decides', async () => {
      const w = await mkWorld();
      await Tenant.collection.insertOne({ tenantId: w.tenantId, name: 'T', capabilities: { usesRequisiciones: true }, isDeleted: false });
      const a = await mkSol(w.tenantId);
      await create(w, [a._id]);
      await expectApi(repuestosService.update(sid(a._id), { EstadoSolicitud: 'Instalado' }, w.tenantId), 409, 'SOLICITUD_EN_REQUISICION');
      await Tenant.collection.updateOne({ tenantId: w.tenantId }, { $set: { 'capabilities.usesRequisiciones': false } });
      assert.equal((await repuestosService.update(sid(a._id), { EstadoSolicitud: 'Instalado' }, w.tenantId)).EstadoSolicitud, 'Instalado');
    });
  });

  // ---------------------------------------------------------------------------------------------- OT creation

  describe('createOtFromSolicitudes with the module on', () => {
    const otBody = (w, ids, extra = {}) => ({
      repuestoIds: ids.map(sid),
      responsableUserIds: [sid(w.tech._id)],
      fechaInicio: new Date(Date.now() + 86400000).toISOString(),
      fechaFin: new Date(Date.now() + 3 * 86400000).toISOString(),
      ...extra,
    });
    const makeOt = (w, ids, extra, who = { userId: sid(w.creator._id), permissions: [] }, caps = CAPS) =>
      repuestosService.createOtFromSolicitudes(otBody(w, ids, extra), w.tenantId, who, { capabilities: caps });

    /** A solicitud made Disponible through the real lifecycle. */
    async function disponible(w, over = {}) {
      const s = await mkSol(w.tenantId, over);
      const { requisicion } = await create(w, [s._id], { enviar: true });
      await approve(w, sid(requisicion._id));
      await setLine(w, requisicion._id, 0, { estadoLinea: 'Confirmada', cantidadConfirmada: 2 }, 'En_Recepcion');
      return s;
    }

    it('Disponible solicitudes -> the OT is created and they become En Proceso', async () => {
      const w = await mkWorld();
      const cliente = oid();
      const a = await disponible(w, { ClienteId: cliente });
      const b = await disponible(w, { ClienteId: cliente });
      const out = await makeOt(w, [a._id, b._id]);
      assert.equal(out.repuestosActualizados, 2);
      for (const s of [a, b]) {
        const d = await rawSol(s._id);
        assert.equal(d.EstadoSolicitud, 'En Proceso');
        assert.equal(sid(d.OrdenId), sid(out.ot._id));
      }
    });

    it('linked but not Disponible -> 409 SOLICITUD_NO_DISPONIBLE with the ids; no OT, nothing changes', async () => {
      const w = await mkWorld();
      const cliente = oid();
      const ok = await disponible(w, { ClienteId: cliente });
      const pending = await mkSol(w.tenantId, { ClienteId: cliente });
      await create(w, [pending._id], { enviar: true });
      const otsBefore = await OT.collection.countDocuments({ tenantId: w.tenantId });
      const err = await expectApi(makeOt(w, [ok._id, pending._id]), 409, 'SOLICITUD_NO_DISPONIBLE');
      assert.deepEqual(err.details.ids, [sid(pending._id)]);
      assert.equal(await OT.collection.countDocuments({ tenantId: w.tenantId }), otsBefore);
      assert.equal((await rawSol(ok._id)).EstadoSolicitud, 'Solicitado');
    });

    it('no requisition -> 409 REQUIERE_REQUISICION with the ids', async () => {
      const w = await mkWorld();
      const cliente = oid();
      const ok = await disponible(w, { ClienteId: cliente });
      const bare = await mkSol(w.tenantId, { ClienteId: cliente });
      const err = await expectApi(makeOt(w, [ok._id, bare._id]), 409, 'REQUIERE_REQUISICION');
      assert.deepEqual(err.details.ids, [sid(bare._id)]);
    });

    it('omitirRequisicion: 403 without manage-all, 400 without reason, and audited with manage-all', async () => {
      const w = await mkWorld();
      const bare = await mkSol(w.tenantId);
      await expectApi(makeOt(w, [bare._id], { omitirRequisicion: true, motivoOmision: 'urgente' }), 403);
      const manager = { userId: sid(w.creator._id), permissions: [PERMISSIONS.REQUISICIONES_MANAGE_ALL] };
      await expectApi(makeOt(w, [bare._id], { omitirRequisicion: true }, manager), 400, 'MOTIVO_REQUERIDO');
      assert.equal((await rawSol(bare._id)).EstadoSolicitud, 'Solicitado');

      const out = await makeOt(w, [bare._id], { omitirRequisicion: true, motivoOmision: 'Paciente crítico' }, manager);
      assert.equal(out.repuestosActualizados, 1);
      assert.equal((await rawSol(bare._id)).EstadoSolicitud, 'En Proceso');
      const traces = await traceOf(bare._id);
      assert.ok(traces.some((c) => c.includes('Requisición omitida') && c.includes('Paciente crítico')), traces.join(' | '));
    });

    it('module OFF: the flow is the previous one', async () => {
      const w = await mkWorld();
      const bare = await mkSol(w.tenantId);
      const out = await makeOt(w, [bare._id], {}, undefined, { usesRequisiciones: false });
      assert.equal(out.repuestosActualizados, 1);
      assert.equal((await rawSol(bare._id)).EstadoSolicitud, 'En Proceso');
    });

    it('a state change between selection and creation is not overwritten (EstadoSolicitud guard)', async () => {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId, { EstadoSolicitud: 'Rechazado' });
      await expectApi(makeOt(w, [a._id], {}, undefined, { usesRequisiciones: false }), 400, 'INVALID_STATE');
      assert.equal((await rawSol(a._id)).EstadoSolicitud, 'Rechazado');
    });
  });

  // ---------------------------------------------------------------------------------------------- list

  describe('GET /repuestos with the module on and off', () => {
    it('module ON: summary + requisicionEstado filter; module OFF: the field never appears even in lean lists', async () => {
      const w = await mkWorld();
      const free = await mkSol(w.tenantId);
      const linked = await mkSol(w.tenantId);
      const { requisicion } = await create(w, [linked._id], { enviar: true });
      await Repuestos.collection.updateOne({ _id: linked._id }, { $set: { stockDescontadoPor: 'requisicion' } });

      const on = await repuestosService.list({}, {}, w.tenantId, CAPS);
      const row = on.data.find((r) => sid(r._id) === sid(linked._id));
      assert.deepEqual(Object.keys(row.requisicion).sort(), ['cantidadConfirmada', 'consecutivo', 'disponibilidad', 'lineaId', 'requisicionId']);
      assert.equal(row.requisicion.consecutivo, requisicion.consecutivo);
      assert.equal(row.requisicion.disponibilidad, 'En_Aprobacion');
      assert.equal('stockDescontadoPor' in row, false);
      assert.equal('requisicion' in on.data.find((r) => sid(r._id) === sid(free._id)), false);

      const ids = async (f) => (await repuestosService.list(f, {}, w.tenantId, CAPS)).data.map((r) => sid(r._id)).sort();
      assert.deepEqual(await ids({ requisicionEstado: 'sin' }), [sid(free._id)]);
      assert.deepEqual(await ids({ requisicionEstado: 'con' }), [sid(linked._id)]);
      assert.deepEqual(await ids({ requisicionEstado: 'En_Aprobacion' }), [sid(linked._id)]);
      assert.deepEqual(await ids({ requisicionEstado: 'Disponible' }), []);

      const off = await repuestosService.list({ requisicionEstado: 'con' }, {}, w.tenantId, { usesRequisiciones: false });
      assert.equal(off.data.length, 2, 'the filter is ignored when the module is off');
      for (const r of off.data) { assert.equal('requisicion' in r, false); assert.equal('stockDescontadoPor' in r, false); }
      const byEquipo = await repuestosService.listByEquipo(sid(linked.EquipoId), null, {}, w.tenantId, { usesRequisiciones: false });
      assert.equal('requisicion' in byEquipo.data[0], false);
      const one = await repuestosService.getById(sid(linked._id), w.tenantId, { usesRequisiciones: false });
      assert.equal('requisicion' in one, false);
      const oneOn = await repuestosService.getById(sid(linked._id), w.tenantId, CAPS);
      assert.equal(oneOn.requisicion.disponibilidad, 'En_Aprobacion');
    });

    it('is tenant scoped', async () => {
      const w = await mkWorld();
      const other = await mkWorld();
      await mkSol(w.tenantId);
      await mkSol(other.tenantId);
      const out = await repuestosService.list({}, {}, w.tenantId, CAPS);
      assert.ok(out.data.every((r) => r.tenantId === w.tenantId));
    });
  });

  // ---------------------------------------------------------------------------------------------- OT completion / stock

  describe('OT completion: no double stock discount', () => {
    async function otWithRepuesto(tenantId, itemId, over = {}) {
      const ot = await OT.create({
        tenantId, ClienteId: oid(), Consecutivo: `OT-${rnd()}`, EstadoOt: 'En Progreso', FechaCreacion: new Date(), Norden: `N${rnd()}`, OtPrioridad: 'Media', TipoServicio: 'Correctivo',
      });
      const r = await mkSol(tenantId, {
        OrdenId: ot._id, EstadoSolicitud: 'En Proceso', InventarioItemId: itemId, CantidadInstalacion: 2, ...over,
      });
      return { ot, r };
    }

    it('a repuesto discounted by the requisition is installed without a second discount; a normal one is discounted once', async () => {
      const tenantId = `t-${rnd()}`;
      await Tenant.collection.insertOne({ tenantId, name: 'T', capabilities: { usesInventoryBasic: true, usesInventoryAdvanced: true, usesRequisiciones: true }, isDeleted: false });
      const itemA = await InventarioRepuesto.create({ tenantId, nombre: 'A', stockActual: 10 });
      const itemB = await InventarioRepuesto.create({ tenantId, nombre: 'B', stockActual: 10 });

      const marked = await otWithRepuesto(tenantId, itemA._id, { stockDescontadoPor: 'requisicion' });
      await oTService.update(sid(marked.ot._id), { EstadoOt: 'Completado' }, tenantId, { userId: sid(oid()) });
      assert.equal((await InventarioRepuesto.findById(itemA._id).lean()).stockActual, 10, 'stock untouched');
      assert.equal((await rawSol(marked.r._id)).EstadoSolicitud, 'Instalado');
      assert.equal(await mongoose.connection.collection('inventario-movimientos').countDocuments({ tenantId, itemId: itemA._id }), 0);

      const normal = await otWithRepuesto(tenantId, itemB._id);
      await oTService.update(sid(normal.ot._id), { EstadoOt: 'Completado' }, tenantId, { userId: sid(oid()) });
      assert.equal((await InventarioRepuesto.findById(itemB._id).lean()).stockActual, 8, 'discounted exactly once');
      assert.equal((await rawSol(normal.r._id)).EstadoSolicitud, 'Instalado');

      // completing again re-runs nothing: still discounted exactly once
      await oTService.update(sid(normal.ot._id), { EstadoOt: 'Completado' }, tenantId, { userId: sid(oid()) });
      assert.equal((await InventarioRepuesto.findById(itemB._id).lean()).stockActual, 8);
    });
  });

  // ---------------------------------------------------------------------------------------------- reception writes + guards on a real server

  describe('recepciones: real conditional writes and immutability', () => {
    async function approvedWithOneLine() {
      const w = await mkWorld();
      const a = await mkSol(w.tenantId);
      const { requisicion } = await create(w, [a._id], { enviar: true });
      const id = sid(requisicion._id);
      await approve(w, id);
      const doc = await Requisicion.findOne({ _id: id, tenantId: w.tenantId });
      return { w, a, id, doc, lineaId: doc.lineas[0].lineaId };
    }
    const ev = (w) => buildTimelineEvent({ tipo: 'RECEPCION_REGISTRADA', actorId: w.tech._id });
    const register = (ctx, over = {}, cantidad = 2, extra = {}) => {
      const recepcionId = oid();
      return Requisicion.appendEvent(
        { _id: ctx.id, tenantId: ctx.w.tenantId, estado: { $in: ['Aprobada', 'En_Recepcion'] } },
        [ev(ctx.w)],
        {
          set: { estado: 'En_Recepcion', 'lineas.$[lin].estadoLinea': 'Recibida', 'lineas.$[lin].cantidadRecibida': cantidad, ...over },
          arrayFilters: [{ 'lin.lineaId': ctx.lineaId }],
          pushRecepciones: { recepcionId, recibidaPor: ctx.w.tech._id, documento: 'REM-1', items: [{ lineaId: ctx.lineaId, cantidadRecibida: cantidad }] },
          ...extra,
        },
      ).then((doc) => ({ doc, recepcionId }));
    };
    const confirm = (ctx, recepcionId, resultado = 'Recibido', set = {}) => Requisicion.appendEvent(
      { _id: ctx.id, tenantId: ctx.w.tenantId, estado: 'En_Recepcion' },
      [buildTimelineEvent({ tipo: 'ENTREGA_CONFIRMADA', actorId: ctx.w.creator._id })],
      {
        confirmarItem: { recepcionId, lineaId: ctx.lineaId, confirmacion: { por: ctx.w.creator._id, fecha: new Date(), resultado, cantidad: 2 } },
        set: { 'lineas.$[lin].estadoLinea': 'Confirmada', 'lineas.$[lin].cantidadConfirmada': 2, ...set },
        arrayFilters: [{ 'lin.lineaId': ctx.lineaId }],
      },
    );

    it('registering a reception is ONE write: state, line, reception and timeline together', async () => {
      const ctx = await approvedWithOneLine();
      const { doc } = await register(ctx);
      assert.equal(doc.estado, 'En_Recepcion');
      assert.equal(doc.lineas[0].estadoLinea, 'Recibida');
      assert.equal(doc.lineas[0].cantidadRecibida, 2);
      assert.equal(doc.recepciones.length, 1);
      assert.equal(doc.recepciones[0].items[0].confirmacion, undefined);
      assert.equal(doc.timeline.at(-1).tipo, 'RECEPCION_REGISTRADA');
      // the same filter cannot be applied from the wrong state
      assert.equal(await Requisicion.appendEvent({ _id: ctx.id, tenantId: ctx.w.tenantId, estado: 'Borrador' }, [ev(ctx.w)], { pushRecepciones: { recibidaPor: ctx.w.tech._id, items: [{ lineaId: ctx.lineaId, cantidadRecibida: 1 }] } }), null);
    });

    it('a confirmation is written once: the second attempt (even through the guarded shape) changes nothing', async () => {
      const ctx = await approvedWithOneLine();
      const { recepcionId } = await register(ctx);
      const first = await confirm(ctx, recepcionId, 'Recibido', { estado: 'Cerrada' });
      assert.equal(first.estado, 'Cerrada');
      assert.equal(first.recepciones[0].items[0].confirmacion.resultado, 'Recibido');
      assert.equal(sid(first.recepciones[0].items[0].confirmacion.por), sid(ctx.w.creator._id));

      // the requisition is no longer En_Recepcion -> null
      assert.equal(await confirm(ctx, recepcionId, 'No_Llego'), null);
      // even forcing the state back by hand, the item filter ($exists:false) refuses to overwrite
      await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(ctx.id) }, { $set: { estado: 'En_Recepcion' } });
      assert.equal(await confirm(ctx, recepcionId, 'No_Llego'), null);
      assert.equal((await rawReq(ctx.id)).recepciones[0].items[0].confirmacion.resultado, 'Recibido');
    });

    it('two confirmations racing for the same item: exactly one wins', async () => {
      const ctx = await approvedWithOneLine();
      const { recepcionId } = await register(ctx);
      const results = await Promise.all(Array.from({ length: 8 }, () => confirm(ctx, recepcionId)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((await rawReq(ctx.id)).timeline.filter((e) => e.tipo === 'ENTREGA_CONFIRMADA').length, 1);
    });

    it('confirming one item leaves the other receptions of the same line untouched', async () => {
      const ctx = await approvedWithOneLine();
      const first = await register(ctx, {}, 1);
      const second = await register(ctx, {}, 1);
      await confirm(ctx, first.recepcionId);
      const recs = (await rawReq(ctx.id)).recepciones;
      assert.equal(recs.length, 2);
      assert.ok(recs[0].items[0].confirmacion);
      assert.equal(recs[1].items[0].confirmacion, undefined);
      assert.equal(sid(recs[1].recepcionId), sid(second.recepcionId));
    });

    it('every forbidden operator is refused by the real update hooks, and the document does not change', async () => {
      const ctx = await approvedWithOneLine();
      const { recepcionId } = await register(ctx);
      const before = JSON.stringify(await rawReq(ctx.id));
      const f = { _id: ctx.id, tenantId: ctx.w.tenantId };
      const AF = [{ 'rec.recepcionId': recepcionId }, { 'itm.lineaId': ctx.lineaId }];
      const attempts = [
        [{ $set: { 'recepciones.0.items.0.cantidadRecibida': 99 } }],
        [{ $set: { recepciones: [] } }],
        [{ $unset: { recepciones: '' } }],
        [{ $pull: { recepciones: { documento: 'REM-1' } } }],
        [{ $pop: { recepciones: 1 } }],
        [{ $inc: { 'recepciones.0.items.0.cantidadRecibida': 1 } }],
        [{ $push: { recepciones: { $each: [{ recibidaPor: ctx.w.tech._id, items: [{ lineaId: ctx.lineaId, cantidadRecibida: 1 }] }], $position: 0 } } }],
        [{ $push: { recepciones: { recibidaPor: ctx.w.tech._id, items: [{ lineaId: ctx.lineaId, cantidadRecibida: 1, confirmacion: { por: ctx.w.creator._id, resultado: 'Recibido' } }] } } }],
        [{ $set: { 'recepciones.$[rec].items.$[itm].confirmacion': { por: ctx.w.creator._id, resultado: 'Recibido' } } }, { arrayFilters: AF }], // missing write-once guard
        [{ $set: { 'recepciones.$[rec].items.$[itm].confirmacion.resultado': 'Recibido' } }, { arrayFilters: AF }],
        [{ $rename: { recepciones: 'x' } }],
        [[{ $set: { estado: 'Cerrada' } }]],
      ];
      for (const [update, options] of attempts) {
        for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
          await assert.rejects(Requisicion[op](f, update, options).exec(), (e) => e.statusCode === 409 && /INMUTABLE/.test(e.code), `${op} ${JSON.stringify(update)}`);
        }
      }
      await assert.rejects(Requisicion.replaceOne(f, { titulo: 'x' }).exec(), (e) => /INMUTABLE/.test(e.code));
      const doc = await Requisicion.findOne(f);
      doc.recepciones[0].documento = 'cambiado';
      await assert.rejects(doc.save(), (e) => e.code === 'RECEPCIONES_INMUTABLES');
      assert.equal(JSON.stringify(await rawReq(ctx.id)), before, 'nothing changed');
    });

    it('the cap of 200 receptions is enforced in the same conditional write', async () => {
      const ctx = await approvedWithOneLine();
      const filler = Array.from({ length: 199 }, () => ({ recepcionId: oid(), recibidaPor: ctx.w.tech._id, items: [{ lineaId: ctx.lineaId, cantidadRecibida: 1 }] }));
      await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(ctx.id) }, { $set: { recepciones: filler } });
      const r200 = await register(ctx, {}, 1);
      assert.equal(r200.doc.recepciones.length, 200, 'the 200th still fits');
      const r201 = await register(ctx, {}, 1);
      assert.equal(r201.doc, null, 'the 201st is refused');
      assert.equal((await rawReq(ctx.id)).recepciones.length, 200);
    });

    it('a requisition of another tenant cannot be written through a foreign filter', async () => {
      const ctx = await approvedWithOneLine();
      const out = await Requisicion.appendEvent({ _id: ctx.id, tenantId: 'otro-tenant' }, [ev(ctx.w)], { pushRecepciones: { recibidaPor: ctx.w.tech._id, items: [{ lineaId: ctx.lineaId, cantidadRecibida: 1 }] } });
      assert.equal(out, null);
      assert.equal((await rawReq(ctx.id)).recepciones.length, 0);
    });
  });

  // ---------------------------------------------------------------------------------------------- backfill

  describe('backfill requisiciones:receive on a real server', () => {
    it('grants the permission only to admin / system roles, never to isDefault, and is idempotent', async () => {
      const tenantId = `t-${rnd()}`;
      const mk = (name, extra = {}) => Role.create({ tenantId, name, permissions: ['users:read'], ...extra });
      const admin = await mk('Admin');
      const adminLower = await mk('admin2'.replace('2', ''), { tenantId: `t-${rnd()}` });
      const system = await mk('Gerencia', { isSystem: true });
      const def = await mk('Technician', { isDefault: true });
      const defAdmin = await mk('ADMIN', { isDefault: true, tenantId: `t-${rnd()}` });
      const plain = await mk('Biomedico');
      const had = await mk('Soporte', { isSystem: true, permissions: ['users:read', RECEIVE_PERMISSION] });
      const deleted = await mk('Admin', { isDeleted: true, tenantId: `t-${rnd()}` });

      const dry = await backfillRequisicionesReceive({ dryRun: true });
      assert.ok(dry.rolesToUpdate >= 3);
      assert.equal((await Role.findById(admin._id).lean()).permissions.includes(RECEIVE_PERMISSION), false, 'dry run writes nothing');

      await backfillRequisicionesReceive();
      const has = async (r) => (await Role.collection.findOne({ _id: r._id })).permissions.includes(RECEIVE_PERMISSION);
      for (const r of [admin, adminLower, system, had]) assert.equal(await has(r), true, r.name);
      for (const r of [def, defAdmin, plain, deleted]) assert.equal(await has(r), false, `${r.name} (${r.isDefault ? 'default' : 'other'})`);
      assert.deepEqual((await Role.collection.findOne({ _id: admin._id })).permissions, ['users:read', RECEIVE_PERMISSION]);

      const again = await backfillRequisicionesReceive();
      assert.equal(again.rolesToUpdate, 0);
      assert.equal(again.rolesUpdated, 0);
    });
  });
});
