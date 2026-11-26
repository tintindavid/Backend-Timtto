/**
 * GET /api/v1/dashboard/* (change: dashboard-por-tenant-indicadores, task 3.7). Project convention: no supertest —
 * the real router stack is inspected and validate(dto, 'query') -> controller are driven with fake req/res; the
 * models are patched with the in-memory fake db.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import dashboardRouter from '../../src/routes/dashboard.routes.js';
import { dashboardController } from '../../src/controllers/dashboard.controller.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { dashboardQueryDto } from '../../src/dtos/dashboard.dto.js';
import { authenticate } from '../../src/middlewares/auth.middleware.js';
import { installFakeDb } from '../helpers/dashboardFakeDb.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { User } from '../../src/models/user.model.js';
import { Ticket } from '../../src/models/ticket.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { COMMON_ROUTE_PREFIXES } from '../../src/config/tenantCapabilities.config.js';

const ENDPOINTS = ['cumplimiento', 'equipos-periodo', 'mis-cifras', 'ranking', 'items', 'tiempos', 'operativos', 'alertas'];
const HANDLER = { cumplimiento: 'cumplimiento', 'equipos-periodo': 'equiposPeriodo', 'mis-cifras': 'misCifras', ranking: 'ranking', items: 'items', tiempos: 'tiempos', operativos: 'operativos', alertas: 'alertas' };
const OID = '507f1f77bcf86cd799439001';
const CAPS = { executesServices: true, managesCustomers: true, usesQrs: true, usesRequisiciones: true };

function res() {
  return { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

/** validate(dto,'query') then the controller handler, returning { err, res }. */
async function call(endpoint, req) {
  const response = res();
  let err;
  validate(dashboardQueryDto, 'query')(req, response, (e) => { err = e; });
  if (err) return { err, res: response };
  await dashboardController[HANDLER[endpoint]](req, response, (e) => { err = e; });
  return { err, res: response };
}

const mkReq = (over = {}) => ({
  query: {}, tenantId: 'tenant-a', tenant: { capabilities: CAPS },
  user: { userId: OID, role: 'admin', permissions: [] },
  ...over,
});

let db;
afterEach(() => { db?.restore(); db = null; });

function installTwoTenants() {
  const eA = new mongoose.Types.ObjectId(); const eB = new mongoose.Types.ObjectId();
  db = installFakeDb({
    EquipoItem: { Model: EquipoItem, rows: [
      { _id: eA, tenantId: 'tenant-a', isDeleted: false, mesesMtto: ['nov'], mesesMttoRealizados: [], UltimoMtto: null, EstadoOperativo: 'Operativo', item: 'A', ClienteId: OID },
      { _id: eB, tenantId: 'tenant-b', isDeleted: false, mesesMtto: ['nov'], mesesMttoRealizados: [], UltimoMtto: null, EstadoOperativo: 'Operativo', item: 'B', ClienteId: OID },
    ] },
    Report: { Model: Report, rows: [] },
    OT: { Model: OT, rows: [] },
    Customer: { Model: Customer, rows: [] },
    User: { Model: User, rows: [] },
    Ticket: { Model: Ticket, rows: [] },
    Requisicion: { Model: Requisicion, rows: [] },
  });
  return db;
}

describe('dashboard router wiring', () => {
  it('exposes the 8 GET endpoints behind authenticate and without any permission guard', () => {
    const layers = dashboardRouter.stack;
    assert.equal(layers[0].handle, authenticate);
    const routes = layers.filter((l) => l.route).map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods), n: l.route.stack.length }));
    assert.deepEqual(routes.map((r) => r.path).sort(), ENDPOINTS.map((e) => `/${e}`).sort());
    for (const r of routes) {
      assert.deepEqual(r.methods, ['get']);
      assert.equal(r.n, 2, 'only validator + controller (no authorize)');
    }
  });

  it('the /dashboard prefix is classified as a common (ungated) route', () => {
    assert.ok(COMMON_ROUTE_PREFIXES.includes('/api/v1/dashboard'));
  });
});

describe('dashboard endpoints: tenant required', () => {
  for (const endpoint of ENDPOINTS) {
    it(`${endpoint}: no tenant (superadmin outside view-as) -> 400 TENANT_REQUIRED, no query`, async () => {
      installTwoTenants();
      for (const tenantId of [undefined, '__platform__']) {
        const { err } = await call(endpoint, mkReq({ tenantId, tenant: undefined, user: { userId: OID, role: 'superadmin', permissions: [] } }));
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'TENANT_REQUIRED');
      }
      assert.equal(db.calls.length, 0);
    });
  }
});

describe('dashboard endpoints: tenant scoping', () => {
  for (const endpoint of ENDPOINTS) {
    it(`${endpoint}: only tenant-a documents are touched, and a client tenantId is ignored`, async () => {
      installTwoTenants();
      const { err, res: response } = await call(endpoint, mkReq({ query: { tenantId: 'tenant-b' } }));
      assert.equal(err, undefined);
      assert.equal(response.body.success, true);
      assert.ok(response.body.data.periodo.etiqueta);
      assert.ok(db.calls.length > 0);
      for (const c of db.calls) assert.equal(c.filter.tenantId, 'tenant-a', `${c.model}.${c.op}`);
      assert.equal(JSON.stringify(response.body).includes('"B"'), false);
    });
  }

  it('the x-tenant-id of the resolver decides: req.tenantId of tenant-b reads only tenant-b', async () => {
    installTwoTenants();
    const { res: response } = await call('equipos-periodo', mkReq({ tenantId: 'tenant-b' }));
    assert.equal(response.body.data.actual.programados, 1);
    for (const c of db.calls) assert.equal(c.filter.tenantId, 'tenant-b');
  });
});

describe('dashboard endpoints: validation', () => {
  it('invalid ObjectIds are 400 VALIDATION_ERROR before the service runs', async () => {
    installTwoTenants();
    for (const field of ['clienteId', 'sedeId', 'servicioId', 'tecnicoId']) {
      const { err } = await call('cumplimiento', mkReq({ query: { [field]: 'not-an-id' } }));
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'VALIDATION_ERROR');
    }
    assert.equal(db.calls.length, 0);
  });

  it('unknown periodo, tipoMtto, unknown params and bad combinations are 400 VALIDATION_ERROR', async () => {
    installTwoTenants();
    for (const query of [
      { periodo: 'semana' }, { tipoMtto: 'Otro' }, { foo: 'bar' },
      { periodo: 'rango' }, { periodo: 'rango', desde: '2026-01-01' },
      { periodo: 'mes_actual', desde: '2026-01-01', hasta: '2026-01-31' }, { anio: 2026 },
      { periodo: 'rango', desde: '2026-02-31', hasta: '2026-03-01' }, { periodo: 'rango', desde: '2026-05-10', hasta: '2026-05-01' },
    ]) {
      const { err } = await call('items', mkReq({ query }));
      assert.equal(err.code, 'VALIDATION_ERROR', JSON.stringify(query));
    }
    assert.equal(db.calls.length, 0);
  });

  it('a range longer than 24 months is 400 PERIOD_TOO_LARGE', async () => {
    installTwoTenants();
    const { err } = await call('tiempos', mkReq({ query: { periodo: 'rango', desde: '2024-01-01', hasta: '2026-01-31' } }));
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'PERIOD_TOO_LARGE');
    assert.equal(db.calls.length, 0);
  });

  it('accepts the full filter set (ids, tipoMtto, rango) and strips tenantId from the validated query', async () => {
    installTwoTenants();
    const req = mkReq({ query: { periodo: 'rango', desde: '2026-10-01', hasta: '2026-11-30', clienteId: OID, sedeId: OID, servicioId: OID, tipoMtto: 'Preventivo', tecnicoId: OID, tenantId: 'x' } });
    const { err } = await call('ranking', req);
    assert.equal(err, undefined);
    assert.equal('tenantId' in req.query, false);
  });

  it('a period selector is optional: the default is the current month', async () => {
    installTwoTenants();
    const { err, res: response } = await call('alertas', mkReq());
    assert.equal(err, undefined);
    assert.match(response.body.data.periodo.desde, /^\d{4}-\d{2}-01$/);
  });
});
