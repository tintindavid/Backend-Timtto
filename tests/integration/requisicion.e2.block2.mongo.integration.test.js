/**
 * Requisiciones E2, adversarial fixes A1 and A5 on a REAL MongoDB through the real services (node:test), tasks 11.8-11.12.
 * SKIPPED unless MONGO_INTEGRATION_URI is set (same convention as requisicion.e2.mongo.integration.test.js; the test
 * creates and DROPS its own database `req_e2b2_<random>`; never point it at a shared / production database).
 *
 *   mongod --dbpath <new empty dir> --port 27745 --bind_ip 127.0.0.1
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27745 node --test tests/integration/requisicion.e2.block2.mongo.integration.test.js
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

describe('Requisiciones E2 block 2 (A1, A5) on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e2b2_${rnd()}`;
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

  const stockOf = async (item) => (await InventarioRepuesto.collection.findOne({ _id: item._id })).stockActual;

  it('A1: omitting the requisition of a LINKED solicitud is refused, so no double stock discount can arise', async () => {
    const w = await mkWorld();
    const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Cable', unidad: 'und', precio: 80, stockActual: 10 });
    const a = await mkSol(w, { nombre: 'Cable', InventarioItemId: item._id });
    const id = await approved(w, [a]);
    const la = (await lineOf(id)).lineaId;
    await receive(w, id, [[la, 2]]);
    const manager = { userId: sid(w.admin._id), permissions: [PERMISSIONS.REQUISICIONES_MANAGE_ALL] };

    // received but not confirmed: linked and not Disponible -> the omission is refused, nothing is created or discounted
    const err = await expectApi(makeOt(w, [a._id], { omitirRequisicion: true, motivoOmision: 'Urgente' }, manager), 409, 'SOLICITUD_EN_REQUISICION');
    assert.deepEqual(err.details.ids, [sid(a._id)]);
    assert.equal((await rawSol(a._id)).EstadoSolicitud, 'Solicitado');
    assert.equal(await OT.countDocuments({ tenantId: w.tenantId }), 0);
    assert.equal(await stockOf(item), 10);

    // after the confirmation it is Disponible: the normal flow works and the OT completion does not discount again
    await confirm(w, id, await lastRecepcionId(id), ok(la).items);
    assert.equal((await rawSol(a._id)).requisicion.disponibilidad, 'Disponible');
    const created = await makeOt(w, [a._id], { omitirRequisicion: true, motivoOmision: 'Disponible igual' }, manager);
    assert.equal(created.repuestosActualizados, 1);
    await oTService.update(sid(created.ot._id), { EstadoOt: 'Completado' }, w.tenantId, { userId: sid(w.tech._id) });
    assert.equal((await rawSol(a._id)).EstadoSolicitud, 'Instalado');
    assert.equal(await stockOf(item), 10, 'net stock unchanged: bought q, installed q');
    assert.equal((await movs(w.tenantId, item._id)).filter((m) => m.referenciaTipo !== 'requisicion').length, 0);
  });

  it('A1: an UNLINKED solicitud can still be sent to an OT by a manage-all user with a reason', async () => {
    const w = await mkWorld();
    const free = await mkSol(w);
    const manager = { userId: sid(w.admin._id), permissions: [PERMISSIONS.REQUISICIONES_MANAGE_ALL] };
    const created = await makeOt(w, [free._id], { omitirRequisicion: true, motivoOmision: 'Sin requisición' }, manager);
    assert.equal(created.repuestosActualizados, 1);
    assert.equal((await rawSol(free._id)).EstadoSolicitud, 'En Proceso');
  });

  it('A5: retrying the confirmation that closed the requisition succeeds without a second write or stock movement', async () => {
    const w = await mkWorld();
    const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Cable', unidad: 'und', precio: 80, stockActual: 10 });
    const a = await mkSol(w, { nombre: 'Cable', InventarioItemId: item._id });
    const id = await approved(w, [a]);
    const la = (await lineOf(id)).lineaId;
    await receive(w, id, [[la, 2]]);
    const rec = await lastRecepcionId(id);
    const first = await confirm(w, id, rec, ok(la).items);
    assert.equal(first.estado, 'Cerrada');
    const before = await rawReq(id);
    const movsBefore = (await movs(w.tenantId, item._id)).length;
    assert.equal(movsBefore, 2);

    const again = await confirm(w, id, rec, ok(la).items);
    assert.equal(again.estado, 'Cerrada');
    const after = await rawReq(id);
    assert.equal(JSON.stringify(after), JSON.stringify(before), 'no new write');
    assert.equal(after.timeline.length, before.timeline.length);
    assert.equal((await movs(w.tenantId, item._id)).length, movsBefore);
    assert.equal(await stockOf(item), 10);

    // a different outcome / a stranger / manage-all with another outcome do not get through
    await expectApi(confirm(w, id, rec, [{ lineaId: sid(la), resultado: 'No_Llego', observacion: 'x' }]), 409, 'ENTREGA_YA_CONFIRMADA');
    await expectApi(confirm(w, id, rec, ok(la).items, w.creator), 403, 'NO_ES_RESPONSABLE');
    assert.equal((await rawReq(id)).timeline.length, before.timeline.length);
  });

  it('A5: a Cerrada requisition still rejects a NEW confirmation', async () => {
    const w = await mkWorld();
    const a = await mkSol(w);
    const b = await mkSol(w);
    const id = await approved(w, [a, b]);
    const doc = await rawReq(id);
    const [la, lb] = doc.lineas.map((l) => l.lineaId);
    await receive(w, id, [[la, 2], [lb, 2]]);
    const rec = await lastRecepcionId(id);
    await confirm(w, id, rec, ok(la).items);
    // force the terminal state (the remaining line was received but never confirmed)
    await Requisicion.collection.updateOne({ _id: doc._id }, { $set: { estado: 'Cerrada' } });
    await expectApi(confirm(w, id, rec, ok(lb).items), 409, 'TRANSICION_INVALIDA');
    assert.equal((await rawReq(id)).recepciones[0].items.find((i) => sid(i.lineaId) === sid(lb)).confirmacion, undefined);
  });
});
