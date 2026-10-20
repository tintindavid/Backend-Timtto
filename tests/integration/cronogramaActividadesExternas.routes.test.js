/**
 * tests/integration/cronogramaActividadesExternas.routes.test.js
 * cronograma-actividades-externas, tasks 3.3 / 3.4 / 4.2. The real cronograma router (authenticate,
 * authorize, validate, controller) behind the real tenant chain; the models are stubbed at the DB boundary.
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { CadenaActividad } from '../../src/models/cadenaActividad.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';
import { tryAuthenticate } from '../../src/middlewares/tryAuthenticate.middleware.js';
import { enforceTenantTokenMatch } from '../../src/middlewares/enforceTenantTokenMatch.middleware.js';
import { tenantResolver } from '../../src/middlewares/tenant.middleware.js';
import { enforceTenantCapabilities } from '../../src/middlewares/enforceTenantCapabilities.middleware.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import cronogramaRoutes from '../../src/routes/cronograma.routes.js';
import { PERMISSION_VALUES } from '../../src/constants/permissions.js';
import { signToken } from '../../src/utils/jwt.util.js';

const CLI = '507f1f77bcf86cd799439001';
const EQ = '507f1f77bcf86cd799439011';

const TENANTS = {
  hosp: { tenantId: 'hosp', status: 'active', capabilities: { executesServices: false, registersExternal: true } },
  other: { tenantId: 'other', status: 'active' },
};

const CHAINS = [
  { _id: 'c1', tenantId: 'hosp', clienteId: CLI, equipoId: EQ, tipo: 'calibracion', frecuenciaMeses: 6,
    fechaProxima: new Date('2026-03-10T00:00:00Z'), estado: 'vigente', actividadVigenteId: { proveedor: 'ACME', proveedorId: null } },
  { _id: 'c2', tenantId: 'other', clienteId: CLI, equipoId: EQ, tipo: 'calibracion', frecuenciaMeses: 6,
    fechaProxima: new Date('2026-03-10T00:00:00Z'), estado: 'vigente', actividadVigenteId: { proveedor: 'SECRETO', proveedorId: null } },
];

let server; let base;
const saved = {};

before(async () => {
  Object.assign(saved, {
    tenantFindOne: Tenant.findOne, userFindById: User.findById, roleFindOne: Role.findOne,
    chainFind: CadenaActividad.find, equipoFind: EquipoItem.find, customerFind: Customer.find, actFind: EquipoActividadExterna.find,
  });
  Tenant.findOne = (f) => ({ lean: () => Promise.resolve(TENANTS[f.tenantId] ?? null) });
  User.findById = () => ({ select: () => ({ lean: () => Promise.resolve(null) }) });
  Role.findOne = (f) => ({
    select: () => ({ lean: () => Promise.resolve(f._id === 'role-admin' ? { permissions: PERMISSION_VALUES } : { permissions: [] }) }),
  });
  CadenaActividad.find = (filter) => {
    const rows = CHAINS.filter((c) => c.tenantId === filter.tenantId && c.estado === filter.estado);
    const q = { sort: () => q, limit: () => q, populate: () => q, lean: () => Promise.resolve(rows) };
    return q;
  };
  EquipoItem.find = () => {
    const q = { select: () => q, populate: () => q, lean: () => Promise.resolve([{ _id: EQ, tenantId: 'hosp', ItemId: { Nombre: 'Monitor' }, Marca: 'GE', Serie: 'S1' }]) };
    return q;
  };
  Customer.find = () => {
    const q = { select: () => q, lean: () => Promise.resolve([{ _id: CLI, Razonsocial: 'Mi organizacion' }]) };
    return q;
  };

  EquipoActividadExterna.find = () => {
    const q = { select: () => q, lean: () => Promise.resolve([{ tenantId: 'hosp', cadenaId: 'c1', fecha: new Date('2026-03-12T00:00:00Z') }]) };
    return q;
  };

  const app = express();
  app.use(express.json());
  app.use(tryAuthenticate);
  app.use(enforceTenantTokenMatch);
  app.use(tenantResolver);
  app.use(enforceTenantCapabilities);
  app.use('/api/v1/cronogramas', cronogramaRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Tenant.findOne = saved.tenantFindOne;
  User.findById = saved.userFindById;
  Role.findOne = saved.roleFindOne;
  CadenaActividad.find = saved.chainFind;
  EquipoItem.find = saved.equipoFind;
  Customer.find = saved.customerFind;
  EquipoActividadExterna.find = saved.actFind;
  await new Promise((r) => server.close(r));
});

afterEach(() => { /* stubs are suite-wide */ });

const bearer = (payload) => `Bearer ${signToken(payload)}`;
const adminOf = (tenantId) => bearer({ userId: 'u1', role: 'admin', roleId: 'role-admin', tenantId });
const noPermsOf = (tenantId) => bearer({ userId: 'u2', role: 'technician', roleId: 'role-empty', tenantId });
const get = async (path, headers = {}) => {
  const res = await fetch(`${base}/api/v1/cronogramas${path}`, { headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

describe('GET /api/v1/cronogramas/actividades-externas', () => {
  it('without a token -> 401', async () => {
    const { status } = await get('/actividades-externas');
    assert.equal(status, 401);
  });

  it('without equipo-items:read -> 403', async () => {
    const { status } = await get('/actividades-externas', { Authorization: noPermsOf('hosp') });
    assert.equal(status, 403);
  });

  it('a client-type tenant (executesServices=false) can read it', async () => {
    const { status, body } = await get('/actividades-externas', { Authorization: adminOf('hosp') });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.truncated, false);
    assert.equal(body.data.length, 1);
    assert.deepEqual(body.data[0].meses, ['mar', 'sep']);
    assert.equal(body.data[0].proveedor, 'ACME');
    assert.deepEqual(body.data[0].realizadas.map((r) => r.mes), ['mar']);
  });

  it('never returns another tenant\'s chains', async () => {
    const { body } = await get('/actividades-externas', { Authorization: adminOf('hosp') });
    assert.ok(!JSON.stringify(body).includes('SECRETO'));
  });

  it('a tenantId in the query is rejected, the token decides', async () => {
    const { status } = await get('/actividades-externas?tenantId=other', { Authorization: adminOf('hosp') });
    assert.equal(status, 400);
  });

  it('a header naming another tenant is rejected by the token binding', async () => {
    const { status } = await get('/actividades-externas', { Authorization: adminOf('hosp'), 'x-tenant-id': 'other' });
    assert.equal(status, 403);
  });

  it('validates the query: bad month, bad tipo, bad id, bad limit -> 400', async () => {
    for (const qs of ['mes=xyz', 'tipo=otra', 'clienteId=123', 'limit=0', 'limit=6000', 'anio=abc', 'anio=1990']) {
      const { status } = await get(`/actividades-externas?${qs}`, { Authorization: adminOf('hosp') });
      assert.equal(status, 400, qs);
    }
  });

  it('accepts valid filters', async () => {
    const { status } = await get(`/actividades-externas?clienteId=${CLI}&mes=sep&tipo=calibracion&anio=2026&limit=10`, { Authorization: adminOf('hosp') });
    assert.equal(status, 200);
  });
});
