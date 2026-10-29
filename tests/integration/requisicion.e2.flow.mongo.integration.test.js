/**
 * Requisiciones E2: the COMPLETE flow on a REAL MongoDB through the real services (node:test), task 7.1.
 * SKIPPED unless MONGO_INTEGRATION_URI is set (same convention as requisicion.e2.mongo.integration.test.js; the test
 * creates and DROPS its own database `req_e2flow_<random>`; never point it at a shared / production database).
 *
 *   mongod --dbpath <new empty dir> --port 27744 --bind_ip 127.0.0.1
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27744 node --test tests/integration/requisicion.e2.flow.mongo.integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../../src/models/repuestotrazabilidad.model.js';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { InventarioMovimiento } from '../../src/models/inventarioMovimiento.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Report } from '../../src/models/report.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { requisicionService } from '../../src/services/requisicion.service.js';
import { requisicionApprovalService } from '../../src/services/requisicionApproval.service.js';
import { requisicionRecepcionService as recepcion } from '../../src/services/requisicionRecepcion.service.js';
import { repuestoRequisicionService } from '../../src/services/repuestoRequisicion.service.js';
import { repuestosService } from '../../src/services/repuestos.service.js';
import { reconcileSolicitudes } from '../../src/services/requisicionSolicitudSync.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { areaService } from '../../src/services/area.service.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { reglaAprobacionService } from '../../src/services/reglaAprobacion.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { oTService } from '../../src/services/ot.service.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
const sid = (v) => String(v);
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
const mkUser = (tenantId, extra = {}) => {
  userSeq += 1;
  return User.create({ tenantId, email: `u${userSeq}-${rnd()}@t.co`, password: 'x'.repeat(10), fullName: `U${userSeq}`, ...extra });
};
const mkRole = (tenantId, permissions) => Role.create({ tenantId, name: `r-${rnd()}`, permissions });

/** Tenant (all modules on) + creator, jefe (approves), receiver (receive), requester (responsible), admin (manage-all), tech. */
async function mkWorld(caps = CAPS_STOCK) {
  const tenantId = `t-${rnd()}`;
  await Tenant.collection.insertOne({ tenantId, name: 'T', capabilities: caps, isDeleted: false });
  const creator = await mkUser(tenantId);
  const jefe = await mkUser(tenantId, { roleId: (await mkRole(tenantId, [PERMISSIONS.REQUISICIONES_APPROVE]))._id });
  const receiver = await mkUser(tenantId, { roleId: (await mkRole(tenantId, [PERMISSIONS.REQUISICIONES_RECEIVE]))._id });
  const requester = await mkUser(tenantId);
  const admin = await mkUser(tenantId, { roleId: (await mkRole(tenantId, [PERMISSIONS.REQUISICIONES_MANAGE_ALL]))._id });
  const tech = await mkUser(tenantId, { roleId: (await mkRole(tenantId, ['ots:can-be-responsible']))._id });
  const tipo = await tipoRequisicionService.create(tenantId, { nombre: 'Repuesto', codigo: 'rep' });
  const area = await areaService.create(tenantId, { nombre: 'Biomedica', codigo: 'bio', jefesIds: [sid(jefe._id)] });
  await reglaAprobacionService.create(tenantId, { orden: 1, nombre: 'Jefe', montoDesde: 0, montoHasta: null, aprobadorTipo: 'jefe_area' });
  return { tenantId, creator, jefe, receiver, requester, admin, tech, tipo, area, caps };
}

const actor = (u, canManageAll = false) => ({ userId: sid(u._id), name: 'x', canManageAll });
let solSeq = 0;
const mkSol = (w, over = {}) => {
  solSeq += 1;
  return Repuestos.create({
    tenantId: w.tenantId, nombre: `Sensor ${solSeq}`, Cantidad: '2', EquipoId: oid(), OrdenId: oid(), ClienteId: w.cliente || oid(),
    ReporteSolicitudId: oid(), ResponsableSolicitud: w.requester._id, EstadoSolicitud: 'Solicitado', CantidadInstalacion: 2, ...over,
  });
};
const rawSol = (id) => Repuestos.collection.findOne({ _id: new mongoose.Types.ObjectId(sid(id)) });
const rawReq = (id) => Requisicion.collection.findOne({ _id: new mongoose.Types.ObjectId(sid(id)) });
const traceOf = async (id) => (await RepuestoTrazabilidad.collection.find({ SolicitudRepuestoId: new mongoose.Types.ObjectId(sid(id)) }).sort({ createdAt: 1, _id: 1 }).toArray()).map((t) => t.Comentarios);
const create = (w, ids, extra = {}, who = w.creator) => repuestoRequisicionService.createFromSolicitudes(w.tenantId, actor(who), {
  repuestoIds: ids.map(sid), tipoRequisicionId: sid(w.tipo._id), areaId: sid(w.area._id), justificacion: 'Se requiere para el servicio', ...extra,
}, w.caps);
const approve = async (w, id) => requisicionApprovalService.approve(w.tenantId, sid(id), actor(w.jefe), { version: (await rawReq(id)).version });
/** Created + sent + approved requisition over the given solicitudes. */
async function approved(w, sols) {
  const { requisicion } = await create(w, sols.map((s) => s._id), { enviar: true });
  await approve(w, requisicion._id);
  return sid(requisicion._id);
}
const lineOf = async (id, i = 0) => (await rawReq(id)).lineas[i];
const receive = (w, id, items, who = w.receiver) => recepcion.registrar(w.tenantId, id, actor(who), { documento: 'REM-1', items: items.map(([lineaId, q]) => ({ lineaId: sid(lineaId), cantidadRecibida: q })) }, [], w.caps);
const lastRecepcionId = async (id) => sid((await rawReq(id)).recepciones.at(-1).recepcionId);
const ok = (lineaId, extra = {}) => ({ items: [{ lineaId: sid(lineaId), resultado: 'Recibido', ...extra }] });
const confirm = (w, id, recId, items, who = w.requester, caps = w.caps) => recepcion.confirmar(w.tenantId, id, recId, actor(who), { items }, caps);
const movs = (tenantId, itemId) => InventarioMovimiento.collection.find({ tenantId, itemId }).sort({ createdAt: 1 }).toArray();
const otBody = (w, ids, extra = {}) => ({
  repuestoIds: ids.map(sid), responsableUserIds: [sid(w.tech._id)],
  fechaInicio: new Date(Date.now() + 86400000).toISOString(), fechaFin: new Date(Date.now() + 3 * 86400000).toISOString(), ...extra,
});
const makeOt = (w, ids, extra, who = { userId: sid(w.creator._id), permissions: [] }) =>
  repuestosService.createOtFromSolicitudes(otBody(w, ids, extra), w.tenantId, who, { capabilities: w.caps });

describe('Requisiciones E2 complete flow on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e2flow_${rnd()}`;
  let savedEmit;
  let savedEnforce;

  before(async () => {
    savedEnforce = process.env.ENFORCE_TENANT_CAPABILITIES;
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    await mongoose.connect(URI, { dbName });
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    for (const m of [Requisicion, Area, TipoRequisicion, ReglaAprobacion, Counter, User, Role, Repuestos, RepuestoTrazabilidad, InventarioRepuesto, InventarioMovimiento, OT, Report, Tenant]) {
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

  describe('happy path: solicitud -> requisicion -> approval -> partial + rest reception -> confirmation -> OT -> completion', () => {
    it('runs end to end, with no second stock discount, a Cerrada requisition, traces and an ordered timeline', async () => {
      const w = await mkWorld();
      w.cliente = oid();
      const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Cable ECG', unidad: 'und', precio: 80, stockActual: 10 });
      const a = await mkSol(w, { nombre: 'Cable ECG', InventarioItemId: item._id }); // stock linked, 2 units
      const b = await mkSol(w, { nombre: 'Electrodo', Cantidad: '1', CantidadInstalacion: 1 }); // free line
      const id = await approved(w, [a, b]);
      let doc = await rawReq(id);
      assert.equal(doc.estado, 'Aprobada');
      const [la, lb] = doc.lineas.map((l) => l.lineaId);
      assert.equal(sid(doc.lineas[0].inventarioItemId), sid(item._id));
      for (const s of [a, b]) assert.equal((await rawSol(s._id)).requisicion.disponibilidad, 'En_Abastecimiento');

      // partial reception: 1 of 2 of A
      const r1 = await receive(w, id, [[la, 1]]);
      assert.equal(r1.estado, 'En_Recepcion');
      assert.equal((await lineOf(id, 0)).estadoLinea, 'Recibida_Parcial');
      assert.equal((await rawSol(a._id)).requisicion.disponibilidad, 'En_Abastecimiento');
      const rec1 = await lastRecepcionId(id);
      // the rest of A + all of B
      await receive(w, id, [[la, 1], [lb, 1]]);
      const rec2 = await lastRecepcionId(id);
      assert.equal((await lineOf(id, 0)).estadoLinea, 'Recibida');
      for (const s of [a, b]) assert.equal((await rawSol(s._id)).requisicion.disponibilidad, 'Recibida');
      assert.equal((await movs(w.tenantId, item._id)).length, 0, 'stock is only moved at confirmation');

      // not yet Disponible: OT creation refused
      await expectApi(makeOt(w, [a._id, b._id]), 409, 'SOLICITUD_NO_DISPONIBLE');

      // confirmations: the receiver cannot, a stranger cannot, the responsible can
      await expectApi(confirm(w, id, rec1, ok(la).items, w.receiver), 403, 'SEPARACION_FUNCIONES');
      await expectApi(confirm(w, id, rec1, ok(la).items, w.creator), 403, 'NO_ES_RESPONSABLE');
      await confirm(w, id, rec1, [{ lineaId: sid(la), resultado: 'Recibido' }]);
      assert.equal((await rawSol(a._id)).requisicion.cantidadConfirmada, 1);
      assert.notEqual((await rawSol(a._id)).requisicion.disponibilidad, 'Disponible', '1 of 2 confirmed');
      await expectApi(confirm(w, id, rec1, [{ lineaId: sid(la), resultado: 'No_Llego', observacion: 'x' }]), 409, 'ENTREGA_YA_CONFIRMADA');
      const out = await confirm(w, id, rec2, [{ lineaId: sid(la), resultado: 'Recibido' }, { lineaId: sid(lb), resultado: 'Recibido' }]);
      assert.equal(out.estado, 'Cerrada');
      doc = await rawReq(id);
      assert.equal(doc.estado, 'Cerrada');
      assert.deepEqual(doc.lineas.map((l) => l.estadoLinea), ['Confirmada', 'Confirmada']);
      for (const s of [a, b]) {
        const r = (await rawSol(s._id)).requisicion;
        assert.equal(r.disponibilidad, 'Disponible');
      }
      assert.equal((await rawSol(a._id)).requisicion.cantidadConfirmada, 2);

      // kardex: entrada + salida (per confirmed tranche) referenced to the requisition; net stock unchanged
      const ms = await movs(w.tenantId, item._id);
      assert.ok(ms.every((m) => m.referenciaTipo === 'requisicion' && m.referenciaId === id));
      const sum = (tipo) => ms.filter((m) => m.tipo === tipo).reduce((n, m) => n + m.cantidad, 0);
      assert.equal(sum('entrada'), 2);
      assert.equal(sum('salida'), 2);
      assert.equal((await InventarioRepuesto.collection.findOne({ _id: item._id })).stockActual, 10);
      assert.equal((await rawSol(a._id)).stockDescontadoPor, 'requisicion');
      assert.equal((await rawSol(b._id)).stockDescontadoPor, undefined, 'free line: no stock mark');

      // OT with ONLY Disponible solicitudes, then completion: no second discount
      const created = await makeOt(w, [a._id, b._id]);
      assert.equal(created.repuestosActualizados, 2);
      const otId = sid(created.ot._id);
      assert.equal((await rawSol(a._id)).EstadoSolicitud, 'En Proceso');
      await oTService.update(otId, { EstadoOt: 'Completado' }, w.tenantId, { userId: sid(w.tech._id) });
      assert.equal((await rawSol(a._id)).EstadoSolicitud, 'Instalado');
      assert.equal((await rawSol(b._id)).EstadoSolicitud, 'Instalado');
      const after = await movs(w.tenantId, item._id);
      assert.equal(after.length, ms.length, 'no movement added by the OT completion');
      assert.equal(after.filter((m) => m.referenciaTipo !== 'requisicion').length, 0);
      assert.equal((await InventarioRepuesto.collection.findOne({ _id: item._id })).stockActual, 10, 'net stock unchanged');
      assert.equal((await rawReq(id)).estado, 'Cerrada');

      // timeline order and traces
      const tipos = (await rawReq(id)).timeline.map((e) => e.tipo);
      const pos = (t, from = 0) => tipos.indexOf(t, from);
      const iEnv = pos('ENVIADA');
      const iRec1 = pos('RECEPCION_REGISTRADA');
      const iRec2 = pos('RECEPCION_REGISTRADA', iRec1 + 1);
      const iC1 = pos('ENTREGA_CONFIRMADA');
      const iCerr = tipos.lastIndexOf('CERRADA');
      assert.ok(iEnv >= 0 && iEnv < iRec1 && iRec1 < iRec2 && iRec2 < iC1 && iC1 < iCerr, tipos.join(','));
      assert.equal(tipos.filter((t) => t === 'ENTREGA_CONFIRMADA').length, 3, 'one event per confirmed item');
      const traces = (await traceOf(a._id)).filter((c) => c.startsWith('Requisición '));
      assert.ok(traces.length >= 4, traces.join(' | '));
      assert.ok(traces[0].includes('En_Requisicion') || traces[0].toLowerCase().includes('requisici'), traces[0]);
      assert.ok(traces.at(-1).includes('disponible'), traces.at(-1));
    });
  });

  describe('regression: a draft keeps its solicitudes linked', () => {
    it('create (no enviar) leaves En_Requisicion links (the sync must accept the populated public shape of the created requisition)', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const { requisicion } = await create(w, [a._id]);
      assert.equal(requisicion.estado, 'Borrador');
      assert.equal(sid((await rawSol(a._id)).requisicion.requisicionId), sid(requisicion._id));
      assert.equal((await rawSol(a._id)).requisicion.disponibilidad, 'En_Requisicion');
      await expectApi(create(w, [a._id]), 409, 'SOLICITUD_YA_VINCULADA');
    });
  });

  describe('dispute and close with shortfall', () => {
    it('No_Llego -> En_Disputa (solicitud too) -> re-reception -> Recibida -> confirmation -> Disponible and Cerrada', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const id = await approved(w, [a]);
      const la = (await lineOf(id)).lineaId;
      await receive(w, id, [[la, 2]]);
      const rec1 = await lastRecepcionId(id);
      await expectApi(confirm(w, id, rec1, [{ lineaId: sid(la), resultado: 'No_Llego' }]), 400, 'OBSERVACION_REQUERIDA');
      const out = await confirm(w, id, rec1, [{ lineaId: sid(la), resultado: 'No_Llego', observacion: 'La caja venia vacia' }]);
      assert.equal(out.estado, 'En_Recepcion');
      assert.equal((await lineOf(id)).estadoLinea, 'En_Disputa');
      assert.equal((await rawSol(a._id)).requisicion.disponibilidad, 'En_Disputa');
      assert.ok((await rawReq(id)).timeline.some((e) => e.tipo === 'ENTREGA_DISPUTADA'));

      // a dispute cannot be closed while it has nothing pending? (it has none) -> a new reception resolves it
      await receive(w, id, [[la, 2]]);
      assert.equal((await lineOf(id)).cantidadRecibida, 4 - 2, 'the disputed tranche no longer counts (cap respected)');
      assert.equal((await lineOf(id)).estadoLinea, 'Recibida');
      assert.equal((await rawSol(a._id)).requisicion.disponibilidad, 'Recibida');
      const rec2 = await lastRecepcionId(id);
      assert.equal((await confirm(w, id, rec2, ok(la).items)).estado, 'Cerrada');
      assert.equal((await rawSol(a._id)).requisicion.disponibilidad, 'Disponible');
      assert.equal((await rawSol(a._id)).requisicion.cantidadConfirmada, 2);
    });

    it('close short: 1 of 2 confirmed + motivo -> Disponible with cantidadConfirmada 1; nothing confirmed -> cancelled and released', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const b = await mkSol(w);
      const id = await approved(w, [a, b]);
      const [la, lb] = (await rawReq(id)).lineas.map((l) => l.lineaId);
      await receive(w, id, [[la, 1]]);
      await confirm(w, id, await lastRecepcionId(id), ok(la).items);
      await expectApi(recepcion.cerrarLinea(w.tenantId, id, sid(la), actor(w.receiver), {}, w.caps), 400, 'MOTIVO_REQUERIDO');
      await recepcion.cerrarLinea(w.tenantId, id, sid(la), actor(w.receiver), { motivo: 'El proveedor solo envio uno' }, w.caps);
      let sol = (await rawSol(a._id)).requisicion;
      assert.equal(sol.disponibilidad, 'Disponible');
      assert.equal(sol.cantidadConfirmada, 1);
      assert.ok((await rawReq(id)).timeline.some((e) => e.tipo === 'LINEA_CERRADA'));

      // line B: nothing confirmed -> cancelled, solicitud released (selectable again) -> requisition closes
      const out = await recepcion.cerrarLinea(w.tenantId, id, sid(lb), actor(w.receiver), { motivo: 'Ya no se necesita' }, w.caps);
      assert.equal((await lineOf(id, 1)).estadoLinea, 'Cancelada');
      assert.equal((await rawSol(b._id)).requisicion, undefined);
      assert.equal(out.estado, 'Cerrada');
      assert.equal((await rawReq(id)).estado, 'Cerrada');
      sol = (await rawSol(a._id)).requisicion;
      assert.equal(sol.disponibilidad, 'Disponible');
      assert.equal((await create(w, [b._id])).requisicion.estado, 'Borrador', 'the released solicitud can be requisitioned again');
    });
  });

  describe('locks', () => {
    it('update / install / delete of a linked non-Disponible solicitud -> 409 SOLICITUD_EN_REQUISICION; Disponible lifts the lock', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const id = await approved(w, [a]);
      const la = (await lineOf(id)).lineaId;
      for (const data of [{ EstadoSolicitud: 'Instalado' }, { nombre: 'Otro' }, { Cantidad: '9' }]) {
        await expectApi(repuestosService.update(sid(a._id), data, w.tenantId, w.caps), 409, 'SOLICITUD_EN_REQUISICION');
      }
      await expectApi(repuestosService.delete(sid(a._id), w.tenantId, w.caps), 409, 'SOLICITUD_EN_REQUISICION');
      await receive(w, id, [[la, 2]]);
      await expectApi(repuestosService.update(sid(a._id), { EstadoSolicitud: 'Instalado' }, w.tenantId, w.caps), 409, 'SOLICITUD_EN_REQUISICION');
      await confirm(w, id, await lastRecepcionId(id), ok(la).items);
      const upd = await repuestosService.update(sid(a._id), { EstadoSolicitud: 'Instalado' }, w.tenantId, w.caps);
      assert.equal(upd.EstadoSolicitud, 'Instalado');
    });

    it('OT creation: non-linked -> REQUIERE_REQUISICION, linked non-Disponible -> SOLICITUD_NO_DISPONIBLE; manage-all omission is audited', async () => {
      const w = await mkWorld();
      w.cliente = oid();
      const bare = await mkSol(w);
      const pending = await mkSol(w);
      await create(w, [pending._id], { enviar: true });
      await expectApi(makeOt(w, [bare._id]), 409, 'REQUIERE_REQUISICION');
      const err = await expectApi(makeOt(w, [pending._id]), 409, 'SOLICITUD_NO_DISPONIBLE');
      assert.deepEqual(err.details.ids, [sid(pending._id)]);
      await expectApi(makeOt(w, [bare._id], { omitirRequisicion: true, motivoOmision: 'urgente' }), 403);
      const manager = { userId: sid(w.admin._id), permissions: [PERMISSIONS.REQUISICIONES_MANAGE_ALL] };
      const created = await makeOt(w, [bare._id], { omitirRequisicion: true, motivoOmision: 'Paciente critico' }, manager);
      assert.equal(created.repuestosActualizados, 1);
      assert.ok((await traceOf(bare._id)).some((c) => c.includes('Requisición omitida') && c.includes('Paciente critico')));
      assert.equal((await rawSol(pending._id)).EstadoSolicitud, 'Solicitado', 'the pending one was not touched');
    });
  });

  describe('reject / cancel release the solicitudes', () => {
    it('reject, cancel from Aprobada and cancel mid-reception unlink and trace; the solicitud is selectable again', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const { requisicion } = await create(w, [a._id], { enviar: true });
      await requisicionApprovalService.reject(w.tenantId, sid(requisicion._id), actor(w.jefe), { version: (await rawReq(requisicion._id)).version, observacion: 'No procede' });
      assert.equal((await rawSol(a._id)).requisicion, undefined);
      assert.ok((await traceOf(a._id)).some((c) => c.startsWith('Requisición ')));

      const b = await mkSol(w);
      const idB = await approved(w, [b]);
      await requisicionService.cancelar(w.tenantId, idB, actor(w.creator), { motivo: 'Cambio de plan' });
      assert.equal((await rawSol(b._id)).requisicion, undefined);

      const c = await mkSol(w);
      const idC = await approved(w, [c]);
      await receive(w, idC, [[(await lineOf(idC)).lineaId, 1]]);
      await requisicionService.cancelar(w.tenantId, idC, actor(w.creator), { motivo: 'Proveedor cerro' });
      assert.equal((await rawSol(c._id)).requisicion, undefined);
      assert.equal((await rawReq(idC)).estado, 'Cancelada');
      for (const s of [a, b, c]) assert.equal((await create(w, [s._id])).requisicion.estado, 'Borrador');
    });
  });

  describe('concurrency', () => {
    it('parallel receptions on the same line never exceed the requested quantity', async () => {
      const w = await mkWorld();
      const a = await mkSol(w, { Cantidad: '3' });
      const id = await approved(w, [a]);
      const la = (await lineOf(id)).lineaId;
      const res = await Promise.allSettled(Array.from({ length: 6 }, () => receive(w, id, [[la, 1]])));
      const won = res.filter((r) => r.status === 'fulfilled').length;
      for (const r of res.filter((x) => x.status === 'rejected')) assert.ok(['CANTIDAD_EXCEDE', 'CONFLICTO_CONCURRENTE', 'LINEA_NO_RECIBIBLE'].includes(r.reason.code), r.reason.code);
      const doc = await rawReq(id);
      assert.ok(doc.lineas[0].cantidadRecibida <= 3);
      assert.equal(doc.lineas[0].cantidadRecibida, won, 'every accepted reception is counted exactly once');
      assert.equal(doc.recepciones.length, won);
      assert.equal(doc.recepciones.reduce((n, r) => n + r.items[0].cantidadRecibida, 0), won);
    });

    it('two parallel receptions of the full quantity: exactly one wins', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const id = await approved(w, [a]);
      const la = (await lineOf(id)).lineaId;
      const res = await Promise.allSettled([receive(w, id, [[la, 2]]), receive(w, id, [[la, 2]])]);
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal((await lineOf(id)).cantidadRecibida, 2);
    });

    it('two parallel confirmations of the same item: exactly one wins and stock moves once', async () => {
      const w = await mkWorld();
      const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Cable', stockActual: 7 });
      const a = await mkSol(w, { InventarioItemId: item._id });
      const id = await approved(w, [a]);
      const la = (await lineOf(id)).lineaId;
      await receive(w, id, [[la, 2]]);
      const rec = await lastRecepcionId(id);
      const res = await Promise.allSettled([confirm(w, id, rec, ok(la).items), confirm(w, id, rec, ok(la).items)]);
      // one writes; the other is either rejected (409) or, if it re-reads the finished confirmation, an idempotent success (A5)
      assert.ok(res.filter((r) => r.status === 'fulfilled').length >= 1, JSON.stringify(res.map((r) => r.reason?.code)));
      for (const r of res.filter((x) => x.status === 'rejected')) assert.equal(r.reason.statusCode, 409);
      assert.equal((await lineOf(id)).cantidadConfirmada, 2);
      const ms = await movs(w.tenantId, item._id);
      // standalone mongod: the loser's moves are undone by compensation rows (append-only kardex); on a replica set there are none
      const effective = ms.filter((m) => !String(m.motivo).startsWith('Reversa'));
      assert.ok(effective.length >= 2 && effective.length % 2 === 0);
      assert.equal(ms.filter((m) => m.tipo === 'entrada').length, ms.filter((m) => m.tipo === 'salida').length, 'kardex nets to zero');
      assert.equal((await InventarioRepuesto.collection.findOne({ _id: item._id })).stockActual, 7, 'stock counted once: net unchanged');
    });

    it('two parallel createFromSolicitudes over the same solicitud: exactly one wins', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const res = await Promise.allSettled([create(w, [a._id]), create(w, [a._id], {}, w.admin)]);
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(res.find((r) => r.status === 'rejected').reason.code, 'SOLICITUD_YA_VINCULADA');
    });
  });

  describe('cross-tenant IDOR', () => {
    it('another tenant gets 404 on every reception operation and nothing changes', async () => {
      const w = await mkWorld();
      const o = await mkWorld();
      const a = await mkSol(w);
      const id = await approved(w, [a]);
      const la = (await lineOf(id)).lineaId;
      await receive(w, id, [[la, 2]]);
      const rec = await lastRecepcionId(id);
      const before = JSON.stringify(await rawReq(id));
      await expectApi(requisicionService.getById(o.tenantId, id), 404);
      await expectApi(recepcion.registrar(o.tenantId, id, actor(o.receiver), { items: [{ lineaId: sid(la), cantidadRecibida: 1 }] }, [], o.caps), 404);
      await expectApi(recepcion.confirmar(o.tenantId, id, rec, actor(o.admin, true), { items: ok(la).items }, o.caps), 404);
      await expectApi(recepcion.cerrarLinea(o.tenantId, id, sid(la), actor(o.admin, true), { motivo: 'x' }, o.caps), 404);
      assert.equal(JSON.stringify(await rawReq(id)), before);
      assert.equal((await rawSol(a._id)).requisicion.disponibilidad, 'Recibida');
      const list = await requisicionService.list(o.tenantId, sid(o.admin._id), { vista: 'por-confirmar' }, { page: 1, limit: 50 }, { canManageAll: true });
      assert.deepEqual(list.data.map((r) => sid(r._id)), []);
    });
  });

  describe('module OFF: no regression', () => {
    it('repuestos update / install / delete / OT creation behave as before and never expose requisicion data', async () => {
      const w = await mkWorld({ usesInventoryBasic: true });
      w.cliente = oid();
      const off = { usesInventoryBasic: true };
      w.caps = off;
      const a = await mkSol(w);
      const b = await mkSol(w);
      const c = await mkSol(w);
      // a stale link must lock nothing and stay hidden
      await Repuestos.collection.updateOne({ _id: a._id }, { $set: { requisicion: { requisicionId: oid(), lineaId: oid(), consecutivo: 'REQ-X', disponibilidad: 'En_Aprobacion' }, stockDescontadoPor: 'requisicion' } });
      const edited = await repuestosService.update(sid(a._id), { nombre: 'Renombrado' }, w.tenantId, off);
      assert.equal(edited.nombre, 'Renombrado');
      assert.equal('requisicion' in edited, false);
      assert.equal('stockDescontadoPor' in edited, false);
      const created = await makeOt(w, [a._id, b._id]);
      assert.equal(created.repuestosActualizados, 2);
      assert.equal(JSON.stringify(created).includes('stockDescontadoPor'), false);
      const installed = await repuestosService.update(sid(c._id), { EstadoSolicitud: 'Instalado' }, w.tenantId, off);
      assert.equal(installed.EstadoSolicitud, 'Instalado');
      await repuestosService.delete(sid(c._id), w.tenantId, off);
      assert.equal((await rawSol(c._id)).isDeleted, true);
      const list = await repuestosService.list({}, {}, w.tenantId, off);
      for (const r of list.data) { assert.equal('requisicion' in r, false); assert.equal('stockDescontadoPor' in r, false); }
      await expectApi(create(w, [b._id]), 403, 'CAPABILITY_DISABLED');
    });
  });

  describe('adversarial fixes (A2, A3, A4, A6, B2)', () => {
    it('A4: cancelling after a PARTIAL confirmation closes that line short, keeps the solicitud Disponible and the stock pair/marker consistent', async () => {
      const w = await mkWorld();
      const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Cable', unidad: 'und', precio: 80, stockActual: 10 });
      const a = await mkSol(w, { InventarioItemId: item._id });
      const b = await mkSol(w, { nombre: 'Otro' });
      const id = await approved(w, [a, b]);
      const [la] = (await rawReq(id)).lineas.map((l) => l.lineaId);
      await receive(w, id, [[la, 2]]);
      await confirm(w, id, await lastRecepcionId(id), [{ lineaId: sid(la), resultado: 'Incompleto', cantidad: 1, observacion: 'Solo llego 1' }]);
      assert.equal((await lineOf(id, 0)).estadoLinea, 'En_Disputa');

      const out = await requisicionService.cancelar(w.tenantId, id, actor(w.admin, true), { motivo: 'Proveedor quebró' });
      assert.equal(out.estado, 'Cancelada');
      const line = await lineOf(id, 0);
      assert.equal(line.estadoLinea, 'Confirmada');
      assert.equal(line.cierre.motivo, 'Proveedor quebró');
      assert.equal(line.cantidadConfirmada, 1);
      const solA = await rawSol(a._id);
      assert.equal(solA.requisicion.disponibilidad, 'Disponible');
      assert.equal(solA.requisicion.cantidadConfirmada, 1);
      assert.equal(solA.stockDescontadoPor, 'requisicion');
      assert.equal((await movs(w.tenantId, item._id)).length, 2);
      assert.equal((await rawSol(b._id)).requisicion, undefined, 'nothing confirmed -> released');
      const tipos = (await rawReq(id)).timeline.map((e) => e.tipo);
      assert.ok(tipos.includes('LINEA_CERRADA'));
      assert.equal(tipos.at(-1), 'CANCELADA');
      await expectApi(create(w, [a._id]), 409, 'SOLICITUD_YA_VINCULADA'); // the part cannot be bought twice
      await create(w, [b._id]); // the released one can
    });

    it('A2: two solicitudes sharing a stock item: each line moves its own pair and gets its marker; the OT never discounts again', async () => {
      const w = await mkWorld();
      w.cliente = oid();
      const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Cable', unidad: 'und', precio: 80, stockActual: 10 });
      const a = await mkSol(w, { InventarioItemId: item._id });
      const b = await mkSol(w, { InventarioItemId: item._id });
      const id = await approved(w, [a, b]);
      const doc = await rawReq(id);
      assert.deepEqual(doc.lineas.map((l) => sid(l.inventarioItemId)), [sid(item._id), sid(item._id)]);
      await receive(w, id, doc.lineas.map((l) => [l.lineaId, 2]));
      const out = await confirm(w, id, await lastRecepcionId(id), doc.lineas.map((l) => ({ lineaId: sid(l.lineaId), resultado: 'Recibido' })));
      assert.equal(out.estado, 'Cerrada');
      for (const s of [a, b]) assert.equal((await rawSol(s._id)).stockDescontadoPor, 'requisicion');
      assert.equal((await movs(w.tenantId, item._id)).length, 4);
      assert.equal((await InventarioRepuesto.collection.findOne({ _id: item._id })).stockActual, 10);
      const created = await makeOt(w, [a._id, b._id]);
      await oTService.update(sid(created.ot._id), { EstadoOt: 'Completado' }, w.tenantId, { userId: sid(w.tech._id) });
      assert.equal((await movs(w.tenantId, item._id)).length, 4, 'no second discount');
      assert.equal((await InventarioRepuesto.collection.findOne({ _id: item._id })).stockActual, 10);
      assert.equal((await rawSol(b._id)).EstadoSolicitud, 'Instalado');
    });

    it('A3: reopening a rejected requisition drops the lines whose solicitud another requisition took; none left -> 409 SIN_LINEAS_VIGENTES', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const b = await mkSol(w);
      const { requisicion: r1 } = await create(w, [a._id, b._id], { enviar: true });
      const id1 = sid(r1._id);
      await requisicionApprovalService.reject(w.tenantId, id1, actor(w.jefe), { version: (await rawReq(id1)).version, observacion: 'No procede' });
      const { requisicion: r2 } = await create(w, [b._id]); // b was released by the rejection
      const out = await requisicionService.reabrir(w.tenantId, id1, actor(w.creator), {});
      assert.equal(out.estado, 'Borrador');
      assert.equal(out.lineas.length, 1);
      assert.equal(out.advertencias.length, 1);
      assert.equal(sid(out.advertencias[0].repuestoId), sid(b._id));
      assert.equal(sid((await rawSol(b._id)).requisicion.requisicionId), sid(r2._id), 'b stays with the other requisition');
      assert.equal(sid((await rawSol(a._id)).requisicion.requisicionId), id1);
      assert.match((await rawReq(id1)).timeline.at(-1).observacion, /retiradas/);

      // second case: everything taken
      const c = await mkSol(w);
      const { requisicion: r3 } = await create(w, [c._id], { enviar: true });
      const id3 = sid(r3._id);
      await requisicionApprovalService.reject(w.tenantId, id3, actor(w.jefe), { version: (await rawReq(id3)).version, observacion: 'No' });
      await create(w, [c._id]);
      await expectApi(requisicionService.reabrir(w.tenantId, id3, actor(w.creator), {}), 409, 'SIN_LINEAS_VIGENTES');
      assert.equal((await rawReq(id3)).estado, 'Rechazada');
    });

    it('A6: a forced sync failure leaves a stale link that self-heals on first touch; reconcile repairs the rest and is idempotent', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const b = await mkSol(w);
      const { requisicion: ra } = await create(w, [a._id], { enviar: true });
      const { requisicion: rb } = await create(w, [b._id], { enviar: true });
      const failOnce = async (fn) => {
        const saved = Repuestos.find;
        Repuestos.find = () => { Repuestos.find = saved; throw new Error('forced sync failure'); };
        try { await fn(); } finally { Repuestos.find = saved; }
      };
      await failOnce(() => requisicionService.cancelar(w.tenantId, sid(ra._id), actor(w.creator), { motivo: 'x' }));
      await failOnce(() => requisicionService.cancelar(w.tenantId, sid(rb._id), actor(w.creator), { motivo: 'x' }));
      assert.equal((await rawReq(ra._id)).estado, 'Cancelada');
      assert.equal((await rawReq(ra._id)).solicitudesSyncPendiente, true, 'failed requisition is flagged');
      assert.ok((await rawSol(a._id)).requisicion, 'stale link remains');

      // self-heal: updating a is no longer a 409
      const upd = await repuestosService.update(sid(a._id), { EstadoSolicitud: 'Instalado' }, w.tenantId, w.caps);
      assert.equal(upd.EstadoSolicitud, 'Instalado');
      assert.equal((await rawSol(a._id)).requisicion, undefined);
      assert.ok((await traceOf(a._id)).some((c) => c.includes('enlace obsoleto liberado')));

      // reconcile: dry-run reports without writing, then repairs b and clears both flags
      const dry = await reconcileSolicitudes(w.tenantId, { dryRun: true });
      assert.equal(dry.enlacesObsoletos, 1);
      assert.ok((await rawSol(b._id)).requisicion);
      const done = await reconcileSolicitudes(w.tenantId);
      assert.equal(done.enlacesObsoletos, 1);
      assert.equal(done.marcasLimpiadas, 2);
      assert.equal((await rawSol(b._id)).requisicion, undefined);
      assert.equal((await rawReq(rb._id)).solicitudesSyncPendiente, undefined);
      const again = await reconcileSolicitudes(w.tenantId);
      assert.equal(again.enlacesObsoletos + again.marcasLimpiadas + again.reclamadasSinRequisicion, 0, 'idempotent');
    });

    it('A6: a solicitud claimed by a requisition that never got created (crash after the claim) is healed on claim and by reconcile', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const b = await mkSol(w);
      for (const s of [a, b]) {
        await Repuestos.collection.updateOne({ _id: s._id }, { $set: { requisicion: { requisicionId: oid(), disponibilidad: 'En_Requisicion' }, updatedAt: new Date(0) } });
      }
      const { requisicion } = await create(w, [a._id]); // the stale claim does not block a new requisition
      assert.equal(sid((await rawSol(a._id)).requisicion.requisicionId), sid(requisicion._id));
      const res = await reconcileSolicitudes(w.tenantId);
      assert.equal(res.reclamadasSinRequisicion, 1);
      assert.equal((await rawSol(b._id)).requisicion, undefined);
    });

    it('B2: closing the only pending line with nothing confirmed ends the requisition Cancelada (not Cerrada)', async () => {
      const w = await mkWorld();
      const a = await mkSol(w);
      const id = await approved(w, [a]);
      const la = (await lineOf(id)).lineaId;
      const out = await recepcion.cerrarLinea(w.tenantId, id, sid(la), actor(w.admin, true), { motivo: 'Ya no se necesita' }, w.caps);
      assert.equal(out.estado, 'Cancelada');
      const doc = await rawReq(id);
      assert.equal(doc.timeline.at(-1).tipo, 'CANCELADA');
      assert.match(doc.canceladaMotivo, /Ya no se necesita/);
      assert.equal((await rawSol(a._id)).requisicion, undefined);
    });
  });
});
