/**
 * requisiciones-hacer-desde-solicitud-auto against a REAL MongoDB (SKIPPED unless MONGO_INTEGRATION_URI is set; throwaway
 * mongod only; the test creates and DROPS its own database). Server-fixed type / area and reference price, and the
 * guarantee that no solicitud stays linked after a failure.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { User } from '../../src/models/user.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { repuestoRequisicionService } from '../../src/services/repuestoRequisicion.service.js';
import { areaService } from '../../src/services/area.service.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
const sid = (v) => String(v?._id ?? v);
const CAPS = { usesRequisiciones: true };

async function expectApi(promise, statusCode, code) {
  let err;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, `expected rejection ${statusCode} ${code}`);
  assert.equal(err.statusCode, statusCode, `${err.statusCode} ${err.code}`);
  assert.equal(err.code, code);
}

let seq = 0;
const mkUser = (tenantId, extra = {}) => { seq += 1; return User.create({ tenantId, email: `u${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), fullName: `U${seq}`, ...extra }); };
const mkSol = (tenantId, over = {}) => { seq += 1; return Repuestos.create({ tenantId, nombre: `Sensor ${seq}`, Cantidad: '2', EquipoId: oid(), OrdenId: oid(), ClienteId: oid(), ReporteSolicitudId: oid(), ResponsableSolicitud: oid(), EstadoSolicitud: 'Solicitado', ...over }); };
const link = async (id) => (await Repuestos.collection.findOne({ _id: new mongoose.Types.ObjectId(sid(id)) }))?.requisicion;

async function mkWorld({ withTipo = true, userArea = true } = {}) {
  const tenantId = `t-${rnd()}`;
  const tipo = withTipo ? await tipoRequisicionService.create(tenantId, { nombre: 'Repuestos', codigo: 'REPUESTO' }) : null;
  await tipoRequisicionService.create(tenantId, { nombre: 'Otro', codigo: 'OTRO' });
  const area = await areaService.create(tenantId, { nombre: 'Biomedica', codigo: 'bio', jefesIds: [] });
  const area2 = await areaService.create(tenantId, { nombre: 'Mantenimiento', codigo: 'man', jefesIds: [] });
  const user = await mkUser(tenantId, userArea ? { areaId: area._id } : {});
  return { tenantId, tipo, area, area2, user };
}
const run = (w, ids, extra = {}) => repuestoRequisicionService.createFromSolicitudes(
  w.tenantId, { userId: sid(w.user._id), name: 'x' }, { repuestoIds: ids.map(sid), justificacion: 'Se requiere', ...extra }, CAPS,
);
const countReqs = (tenantId) => Requisicion.collection.countDocuments({ tenantId });

describe('Hacer requisicion automatica on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_auto_${rnd()}`;
  let savedEmit;
  let savedEnforce;

  before(async () => {
    savedEnforce = process.env.ENFORCE_TENANT_CAPABILITIES;
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    await mongoose.connect(URI, { dbName });
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    for (const m of [Requisicion, Area, TipoRequisicion, Counter, User, Repuestos, InventarioRepuesto]) { await m.init(); await m.syncIndexes(); }
  });

  after(async () => {
    if (savedEnforce === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES; else process.env.ENFORCE_TENANT_CAPABILITIES = savedEnforce;
    notificationService.emit = savedEmit;
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  it('own area + REPUESTO type; body areaId ignored; reference price solicitud > inventory > 0', async () => {
    const w = await mkWorld();
    const item = await InventarioRepuesto.create({ tenantId: w.tenantId, nombre: 'Cable', unidad: 'und', precio: 80 });
    const a = await mkSol(w.tenantId, { PrecioRepuesto: 50 });
    const b = await mkSol(w.tenantId, { InventarioItemId: item._id });
    const c = await mkSol(w.tenantId);
    const { requisicion: r } = await repuestoRequisicionService.createFromSolicitudes(
      w.tenantId, { userId: sid(w.user._id), name: 'x' },
      { repuestoIds: [sid(a._id), sid(b._id), sid(c._id)], areaId: sid(w.area2._id), justificacion: 'ok' },
      { usesRequisiciones: true, usesInventoryBasic: true },
    );
    assert.equal(sid(r.tipoRequisicionId), sid(w.tipo._id));
    assert.equal(sid(r.areaId), sid(w.area._id));
    assert.deepEqual(r.lineas.map((l) => l.precioEstimado), [50, 80, 0]);
    assert.equal(r.estado, 'Borrador');
    for (const s of [a, b, c]) assert.equal(sid((await link(s._id)).requisicionId), sid(r._id));
  });

  it('user without area: the body areaId is used', async () => {
    const w = await mkWorld({ userArea: false });
    const a = await mkSol(w.tenantId);
    const { requisicion: r } = await run(w, [a._id], { areaId: sid(w.area2._id) });
    assert.equal(sid(r.areaId), sid(w.area2._id));
  });

  it('user without area and without selection -> 400 AREA_REQUERIDA, nothing linked', async () => {
    const w = await mkWorld({ userArea: false });
    const a = await mkSol(w.tenantId);
    await expectApi(run(w, [a._id]), 400, 'AREA_REQUERIDA');
    assert.equal(await link(a._id), undefined);
    assert.equal(await countReqs(w.tenantId), 0);
  });

  it('tenant without REPUESTO type -> 409 TIPO_REPUESTO_NO_CONFIGURADO, nothing linked', async () => {
    const w = await mkWorld({ withTipo: false });
    const a = await mkSol(w.tenantId);
    await expectApi(run(w, [a._id]), 409, 'TIPO_REPUESTO_NO_CONFIGURADO');
    assert.equal(await link(a._id), undefined);
    assert.equal(await countReqs(w.tenantId), 0);
  });

  it('body areaId of another tenant -> 400 AREA_INVALIDA, nothing linked', async () => {
    const w = await mkWorld({ userArea: false });
    const other = await mkWorld();
    const a = await mkSol(w.tenantId);
    await expectApi(run(w, [a._id], { areaId: sid(other.area._id) }), 400, 'AREA_INVALIDA');
    assert.equal(await link(a._id), undefined);
  });

  it('a user area id belonging to another tenant is not trusted: falls back to the body (AREA_REQUERIDA)', async () => {
    const w = await mkWorld({ userArea: false });
    const other = await mkWorld();
    await User.collection.updateOne({ _id: w.user._id }, { $set: { areaId: other.area._id } });
    const a = await mkSol(w.tenantId);
    await expectApi(run(w, [a._id]), 400, 'AREA_REQUERIDA');
    assert.equal(await link(a._id), undefined);
  });
});
