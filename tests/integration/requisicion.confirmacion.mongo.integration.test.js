/**
 * Confirmation / closing / "por confirmar" view against a REAL MongoDB (requisiciones-e2, tasks 4.4 / 4.5).
 * SKIPPED unless MONGO_INTEGRATION_URI is set (same convention and throwaway-database rules as
 * requisicion.e2.mongo.integration.test.js; the test creates and DROPS its own database).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { InventarioMovimiento } from '../../src/models/inventarioMovimiento.model.js';
import { requisicionService } from '../../src/services/requisicion.service.js';
import { requisicionRecepcionService as svc } from '../../src/services/requisicionRecepcion.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { notificationService } from '../../src/services/notification.service.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
const sid = (v) => String(v);
const actor = (id, canManageAll = false) => ({ userId: sid(id), name: 'x', canManageAll });
const CAPS = { usesRequisiciones: true };
const STOCK_CAPS = { usesRequisiciones: true, usesInventoryBasic: true, usesInventoryAdvanced: true };

/** A requisition En_Recepcion with ONE line of 2 units fully received (unconfirmed) and its linked solicitud. */
async function mkReq(tenantId, { responsable = oid(), recibidaPor = oid(), solicitante = oid(), withOrigen = true, inventarioItemId } = {}) {
  const _id = oid();
  const lineaId = oid();
  const sol = withOrigen ? await Repuestos.create({
    tenantId, nombre: 'Sensor', Cantidad: '2', EquipoId: oid(), OrdenId: oid(), ClienteId: oid(), ReporteSolicitudId: oid(),
    ResponsableSolicitud: responsable, EstadoSolicitud: 'Solicitado',
    requisicion: { requisicionId: _id, lineaId, consecutivo: 'REQ-1', disponibilidad: 'Recibida', cantidadConfirmada: 0 },
  }) : null;
  const recepcionId = oid();
  await Requisicion.collection.insertOne({
    _id, tenantId, consecutivo: `REQ-${rnd()}`, titulo: 'T', tipoRequisicionId: oid(), areaId: oid(), estado: 'En_Recepcion', version: 1,
    creadaPor: oid(), solicitanteId: solicitante, montoEstimado: 20, moneda: 'COP', justificacion: 'x', isDeleted: false,
    aprobacion: { niveles: [], nivelActual: null }, timeline: [],
    lineas: [{
      lineaId, descripcion: 'Sensor', unidad: 'und', cantidadSolicitada: 2, precioEstimado: 10, estadoLinea: 'Recibida', cantidadRecibida: 2, cantidadConfirmada: 0,
      ...(sol ? { origenSolicitudRepuestoId: sol._id } : {}), ...(inventarioItemId ? { inventarioItemId } : {}),
    }],
    recepciones: [{ recepcionId, fecha: new Date(), recibidaPor, evidencias: [], items: [{ lineaId, cantidadRecibida: 2 }] }],
    createdAt: new Date(), updatedAt: new Date(),
  });
  return { id: sid(_id), lineaId: sid(lineaId), recepcionId: sid(recepcionId), sol, responsable, recibidaPor, solicitante };
}

const ok = (lineaId) => ({ items: [{ lineaId, resultado: 'Recibido' }] });
const raw = (id) => Requisicion.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
const inbox = async (tenantId, userId, manage = false) => (await requisicionService.list(tenantId, sid(userId), { vista: 'por-confirmar' }, { page: 1, limit: 50 }, { canManageAll: manage })).data.map((r) => sid(r._id));

describe('Confirmation on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_conf_${rnd()}`;
  let savedEmit;

  before(async () => {
    await mongoose.connect(URI, { dbName });
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    for (const m of [Requisicion, Repuestos, InventarioRepuesto, InventarioMovimiento]) { await m.init(); await m.syncIndexes(); }
  });
  after(async () => {
    notificationService.emit = savedEmit;
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  it('the responsible confirms: real array filters write the confirmation, line Confirmada, requisition Cerrada, solicitud Disponible', async () => {
    const t = `t-${rnd()}`;
    const r = await mkReq(t);
    const out = await svc.confirmar(t, r.id, r.recepcionId, actor(r.responsable), ok(r.lineaId), CAPS);
    assert.equal(out.estado, 'Cerrada');
    const doc = await raw(r.id);
    assert.equal(doc.lineas[0].estadoLinea, 'Confirmada');
    assert.equal(doc.recepciones[0].items[0].confirmacion.resultado, 'Recibido');
    const sol = await Repuestos.collection.findOne({ _id: r.sol._id });
    assert.equal(sol.requisicion.disponibilidad, 'Disponible');
    assert.equal(sol.requisicion.cantidadConfirmada, 2);
  });

  it('two parallel identical confirmations: the quantity is counted once (idempotent loser)', async () => {
    const t = `t-${rnd()}`;
    const r = await mkReq(t);
    await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(r.id) }, { $set: { 'lineas.0.cantidadSolicitada': 4, 'lineas.0.estadoLinea': 'Recibida_Parcial' } });
    const run = () => svc.confirmar(t, r.id, r.recepcionId, actor(r.responsable), ok(r.lineaId), CAPS);
    const res = await Promise.allSettled([run(), run()]);
    assert.equal(res.filter((x) => x.status === 'fulfilled').length, 2, 'identical retry is idempotent');
    assert.equal((await raw(r.id)).lineas[0].cantidadConfirmada, 2);
  });

  it('stock: a paired entrada + salida at confirmation, net zero, the solicitud marked; a deleted item fails with nothing changed', async () => {
    const t = `t-${rnd()}`;
    const item = await InventarioRepuesto.create({ tenantId: t, nombre: 'Sensor', stockActual: 5 });
    const r = await mkReq(t, { inventarioItemId: item._id });
    await svc.confirmar(t, r.id, r.recepcionId, actor(r.responsable), ok(r.lineaId), STOCK_CAPS);
    const movs = await InventarioMovimiento.collection.find({ tenantId: t }).sort({ createdAt: 1 }).toArray();
    assert.deepEqual(movs.map((m) => m.tipo).sort(), ['entrada', 'salida']);
    assert.ok(movs.every((m) => m.referenciaTipo === 'requisicion' && m.referenciaId === r.id));
    assert.equal((await InventarioRepuesto.collection.findOne({ _id: item._id })).stockActual, 5);
    assert.equal((await Repuestos.collection.findOne({ _id: r.sol._id })).stockDescontadoPor, 'requisicion');

    const gone = await mkReq(t, { inventarioItemId: oid() });
    // B4: a missing item does not block the confirmation: it proceeds without stock and records why
    await svc.confirmar(t, gone.id, gone.recepcionId, actor(gone.responsable), ok(gone.lineaId), STOCK_CAPS);
    const doc = await raw(gone.id);
    assert.equal(doc.recepciones[0].items[0].confirmacion.resultado, 'Recibido');
    assert.equal(doc.timeline.find((e) => e.tipo === 'ENTREGA_CONFIRMADA').datos.stockOmitido, 'item_no_disponible');
    assert.equal((await Repuestos.collection.findOne({ _id: gone.sol._id })).stockDescontadoPor, undefined);
    assert.equal((await InventarioMovimiento.collection.countDocuments({ tenantId: t })), 2, 'no movement for the missing item');
  });

  it('vista=por-confirmar: the responsible sees it, others and the one who received do not, manage-all sees all; it leaves the inbox once confirmed', async () => {
    const t = `t-${rnd()}`;
    const r = await mkReq(t);
    const free = await mkReq(t, { withOrigen: false });
    assert.deepEqual(await inbox(t, r.responsable), [r.id]);
    assert.deepEqual(await inbox(t, free.solicitante), [free.id], 'free line -> the requisition requester');
    assert.deepEqual(await inbox(t, oid()), []);
    assert.deepEqual(await inbox(t, r.recibidaPor), [], 'never the receptions he registered');
    assert.deepEqual((await inbox(t, oid(), true)).sort(), [r.id, free.id].sort());
    await svc.confirmar(t, r.id, r.recepcionId, actor(r.responsable), ok(r.lineaId), CAPS);
    assert.deepEqual(await inbox(t, r.responsable), []);
    assert.deepEqual(await inbox(`other-${rnd()}`, r.responsable, true), [], 'tenant isolation');
  });
});
