/**
 * requisiciones-hacer-desde-solicitud-auto, adversarial follow-up, against a REAL MongoDB (SKIPPED unless
 * MONGO_INTEGRATION_URI is set; throwaway mongod only; the test creates and DROPS its own database).
 * Edge cases: inactive REPUESTO type, soft-deleted user area, HTTP-level 400s, and sending an unpriced requisition when
 * the first approval rule starts above 0.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { InventarioRepuesto } from '../../src/models/inventarioRepuesto.model.js';
import { Area } from '../../src/models/area.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { areaService } from '../../src/services/area.service.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { reglaAprobacionService } from '../../src/services/reglaAprobacion.service.js';
import { repuestoRequisicionService } from '../../src/services/repuestoRequisicion.service.js';
import { signToken } from '../../src/utils/jwt.util.js';
import { PERMISSIONS as P } from '../../src/constants/permissions.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
const sid = (v) => String(v?._id ?? v);
const CAPS = { usesRequisiciones: true };

let base;
let server;
const post = async (path, token, json) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  return { status: res.status, body };
};

let seq = 0;
async function mkWorld({ rule = 0 } = {}) {
  seq += 1;
  const tenantId = `ed-${rnd()}`;
  await Tenant.collection.insertOne({ tenantId, name: 'T', status: 'active', capabilities: CAPS, isDeleted: false });
  const role = await Role.create({ tenantId, name: `r${seq}-${rnd()}`, permissions: [P.REQUISICIONES_READ, P.REQUISICIONES_CREATE, P.REQUISICIONES_SEND, P.REPUESTOS_READ] });
  const tipo = await tipoRequisicionService.create(tenantId, { nombre: 'Repuestos', codigo: 'REPUESTO' });
  const area = await areaService.create(tenantId, { nombre: 'Biomedica', codigo: 'bio', jefesIds: [] });
  const user = await User.create({ tenantId, email: `e${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), firstName: 'N', lastName: 'A', fullName: 'N A', roleId: role._id, areaId: area._id });
  await reglaAprobacionService.create(tenantId, { orden: 1, nombre: 'Regla', montoDesde: rule, montoHasta: null, aprobadorTipo: 'jefe_area' });
  const token = signToken({ userId: user._id, role: user.role, roleId: role._id, tenantId });
  return { tenantId, tipo, area, user, token };
}
const mkSol = (tenantId, over = {}) => Repuestos.create({ tenantId, nombre: `Sensor ${rnd()}`, Cantidad: '2', EquipoId: oid(), OrdenId: oid(), ClienteId: oid(), ReporteSolicitudId: oid(), ResponsableSolicitud: oid(), EstadoSolicitud: 'Solicitado', ...over });
const link = async (id) => (await Repuestos.collection.findOne({ _id: new mongoose.Types.ObjectId(sid(id)) }))?.requisicion;
const live = (tenantId) => Requisicion.collection.countDocuments({ tenantId, isDeleted: { $ne: true } });
const run = (w, ids, extra = {}) => repuestoRequisicionService.createFromSolicitudes(w.tenantId, { userId: sid(w.user._id), name: 'x' }, { repuestoIds: ids.map(sid), justificacion: 'Se requiere', ...extra }, CAPS);
async function expectApi(promise, statusCode, code) {
  let err;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, `expected ${statusCode} ${code}`);
  assert.equal(err.statusCode, statusCode, `${err.statusCode} ${err.code}`);
  assert.equal(err.code, code);
  return err;
}

describe('Hacer requisicion automatica: edge cases on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_autoedge_${rnd()}`;
  const saved = {};
  let savedEmit;

  before(async () => {
    for (const k of ['ENFORCE_TENANT_CAPABILITIES', 'RATE_LIMIT_MAX']) saved[k] = process.env[k];
    process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
    process.env.RATE_LIMIT_MAX = '1000000';
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Repuestos, User, Role, Tenant, InventarioRepuesto, Area, TipoRequisicion, ReglaAprobacion, Counter]) { await m.init(); await m.syncIndexes(); }
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    const { default: app } = await import('../../src/app.js');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
    notificationService.emit = savedEmit;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  it('inactive REPUESTO type -> 409 TIPO_REPUESTO_NO_CONFIGURADO (message says exist AND active), nothing linked', async () => {
    const w = await mkWorld();
    await TipoRequisicion.collection.updateOne({ _id: w.tipo._id }, { $set: { activo: false } });
    const a = await mkSol(w.tenantId);
    const err = await expectApi(run(w, [a._id]), 409, 'TIPO_REPUESTO_NO_CONFIGURADO');
    assert.match(err.message, /existir y estar activo/);
    assert.equal(await link(a._id), undefined);
    assert.equal(await live(w.tenantId), 0);
  });

  it('user whose area was soft-deleted and no body areaId -> 400 AREA_REQUERIDA, nothing linked', async () => {
    const w = await mkWorld();
    await Area.collection.updateOne({ _id: w.area._id }, { $set: { isDeleted: true } });
    const a = await mkSol(w.tenantId);
    await expectApi(run(w, [a._id]), 400, 'AREA_REQUERIDA');
    assert.equal(await link(a._id), undefined);
  });

  it('HTTP: tipoRequisicionId and lineas[].precioEstimado -> 400 VALIDATION_ERROR, nothing linked', async () => {
    const w = await mkWorld();
    const a = await mkSol(w.tenantId);
    const base0 = { repuestoIds: [sid(a._id)], justificacion: 'ok' };
    const r1 = await post('/api/v1/repuestos/requisicion', w.token, { ...base0, tipoRequisicionId: sid(w.tipo._id) });
    assert.equal(r1.status, 400, JSON.stringify(r1.body));
    const r2 = await post('/api/v1/repuestos/requisicion', w.token, { ...base0, lineas: [{ repuestoId: sid(a._id), precioEstimado: 5 }] });
    assert.equal(r2.status, 400, JSON.stringify(r2.body));
    assert.equal(await link(a._id), undefined);
    assert.equal(await live(w.tenantId), 0);
    const ok = await post('/api/v1/repuestos/requisicion', w.token, base0);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  it('send with all lines unpriced and a first rule from 100 -> 422 SIN_REGLAS_APROBACION (monto 0, sinPrecios), draft not left, nothing linked', async () => {
    const w = await mkWorld({ rule: 100 });
    const a = await mkSol(w.tenantId);
    const err = await expectApi(run(w, [a._id], { enviar: true }), 422, 'SIN_REGLAS_APROBACION');
    assert.equal(err.details.montoEstimado, 0);
    assert.equal(err.details.sinPrecios, true);
    assert.equal(await link(a._id), undefined);
    assert.equal(await live(w.tenantId), 0);
    // saving as a draft still works
    const { requisicion } = await run(w, [a._id]);
    assert.equal(requisicion.estado, 'Borrador');
  });
});
