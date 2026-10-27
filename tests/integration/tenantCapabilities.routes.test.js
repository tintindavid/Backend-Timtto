/**
 * tests/integration/tenantCapabilities.routes.test.js
 * tenant-capabilities-hybrid-mode, tasks 2.5 / 6.1 / 6.2 / 6.6. The real routers of
 * /api/v1/my-tenant and /api/v1/platform/tenants run behind the real global chain of app.js over
 * HTTP with signed tokens. Only the data layer (model statics / service methods) is stubbed.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { Tenant } from '../../src/models/tenant.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { TenantService } from '../../src/services/tenant.service.js';
import { PlatformTenantService } from '../../src/services/platformTenant.service.js';
import { tryAuthenticate } from '../../src/middlewares/tryAuthenticate.middleware.js';
import { enforceTenantTokenMatch } from '../../src/middlewares/enforceTenantTokenMatch.middleware.js';
import { tenantResolver } from '../../src/middlewares/tenant.middleware.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import platformTenantRoutes from '../../src/routes/platformTenant.routes.js';
import myTenantRoutes from '../../src/routes/myTenant.routes.js';
import { PERMISSION_VALUES } from '../../src/constants/permissions.js';
import { signToken } from '../../src/utils/jwt.util.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const TENANTS = {
  prov: { tenantId: 'prov', status: 'active', organizationCustomerId: null },
  hosp: {
    tenantId: 'hosp', status: 'active',
    capabilities: { executesServices: false, registersExternal: true },
    organizationCustomerId: '507f1f77bcf86cd799439099',
  },
  mixed: { tenantId: 'mixed', status: 'active', capabilities: { executesServices: true, registersExternal: true } },
  t2: { tenantId: 't2', status: 'active', capabilities: { executesServices: false, registersExternal: true }, organizationCustomerId: '507f1f77bcf86cd799439088' },
};
const TENANT_MONGO_ID = '507f1f77bcf86cd799439011';

let server;
// Organization clients that still exist (not soft-deleted): the endpoint must not advertise a deleted one.
const ALIVE_CUSTOMERS = new Set(['507f1f77bcf86cd799439099', '507f1f77bcf86cd799439088']);
let base;
const saved = {};
let updateCalls;

before(async () => {
  saved.findOne = Tenant.findOne;
  saved.customerExists = Customer.exists;
  saved.userFindById = User.findById;
  saved.roleFindOne = Role.findOne;
  saved.update = TenantService.update;
  saved.updateCapabilities = PlatformTenantService.updateCapabilities;

  Tenant.findOne = (filter) => ({ lean: () => Promise.resolve(TENANTS[filter.tenantId] ?? null) });
  Customer.exists = async (filter) => (ALIVE_CUSTOMERS.has(String(filter._id)) && filter.isDeleted === false ? { _id: filter._id } : null);
  // authenticate(): the user lookup is cosmetic, the role lookup yields the permissions.
  User.findById = () => ({ select: () => ({ lean: () => Promise.resolve(null) }) });
  Role.findOne = (filter) => ({
    select: () => ({
      lean: () => Promise.resolve(filter._id === 'role-admin' ? { permissions: PERMISSION_VALUES } : { permissions: [] }),
    }),
  });

  const app = express();
  app.use(express.json());
  app.use(tryAuthenticate);
  app.use(enforceTenantTokenMatch);
  app.use(tenantResolver);
  app.use('/api/v1/platform/tenants', platformTenantRoutes);
  app.use('/api/v1/my-tenant', myTenantRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Tenant.findOne = saved.findOne;
  Customer.exists = saved.customerExists;
  User.findById = saved.userFindById;
  Role.findOne = saved.roleFindOne;
  TenantService.update = saved.update;
  PlatformTenantService.updateCapabilities = saved.updateCapabilities;
  await new Promise((r) => server.close(r));
});

beforeEach(() => { updateCalls = []; });

const bearer = (payload) => `Bearer ${signToken(payload)}`;
const adminOf = (tenantId) => bearer({ userId: 'u1', role: 'admin', roleId: 'role-admin', tenantId });
const techOf = (tenantId) => bearer({ userId: 'u2', role: 'technician', roleId: 'role-empty', tenantId });
const superadmin = () => bearer({ userId: 's1', role: 'superadmin', tenantId: '__platform__' });
const req = async (method, path, { headers = {}, body } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

describe('GET /api/v1/my-tenant/capabilities', () => {
  it('a provider tenant without the stored field gets the defaults and type provider', async () => {
    const { status, body } = await req('GET', '/api/v1/my-tenant/capabilities', { headers: { Authorization: adminOf('prov') } });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, {
      executesServices: true, registersExternal: false, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false, usesRequisiciones: false, managesCustomers: true, type: 'provider', organizationCustomerId: null,
    });
  });

  it('a role WITHOUT my-tenant:read still gets 200 (only authentication is required)', async () => {
    const { status, body } = await req('GET', '/api/v1/my-tenant/capabilities', { headers: { Authorization: techOf('hosp') } });
    assert.equal(status, 200);
    assert.deepEqual(body.data, {
      executesServices: false, registersExternal: true, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false, usesRequisiciones: false, managesCustomers: false, type: 'client', organizationCustomerId: '507f1f77bcf86cd799439099',
    });
  });

  it('a soft-deleted organization client is not advertised (the sidebar would link to a 404)', async () => {
    ALIVE_CUSTOMERS.delete('507f1f77bcf86cd799439099');
    try {
      const { status, body } = await req('GET', '/api/v1/my-tenant/capabilities', { headers: { Authorization: adminOf('hosp') } });
      assert.equal(status, 200);
      assert.equal(body.data.organizationCustomerId, null);
      assert.equal(body.data.type, 'client');
    } finally {
      ALIVE_CUSTOMERS.add('507f1f77bcf86cd799439099');
    }
  });

  it('a hybrid tenant is reported as hybrid', async () => {
    const { body } = await req('GET', '/api/v1/my-tenant/capabilities', { headers: { Authorization: adminOf('mixed') } });
    assert.equal(body.data.type, 'hybrid');
  });

  it('superadmin in view-as gets the viewed tenant (even though the resolver does not look it up)', async () => {
    const { status, body } = await req('GET', '/api/v1/my-tenant/capabilities', { headers: { Authorization: superadmin(), 'x-tenant-id': 't2' } });
    assert.equal(status, 200);
    assert.equal(body.data.executesServices, false);
    assert.equal(body.data.type, 'client');
    assert.equal(body.data.organizationCustomerId, '507f1f77bcf86cd799439088');
  });

  it('the platform sentinel returns everything enabled, type hybrid and a null organization client', async () => {
    const { status, body } = await req('GET', '/api/v1/my-tenant/capabilities', { headers: { Authorization: superadmin() } });
    assert.equal(status, 200);
    assert.deepEqual(body.data, {
      executesServices: true, registersExternal: true, usesQrs: true, scheduleQuickLoad: true, usesInventoryBasic: true, usesInventoryAdvanced: true, usesRequisiciones: true, managesCustomers: true, type: 'hybrid', organizationCustomerId: null,
    });
  });

  it('requires authentication', async () => {
    const { status, body } = await req('GET', '/api/v1/my-tenant/capabilities');
    assert.equal(status, 401);
    assert.equal(body.error.code, 'NO_TOKEN_PROVIDED');
  });

  it('a user can never read another tenant: the foreign header is 403 before the handler', async () => {
    const { status, body } = await req('GET', '/api/v1/my-tenant/capabilities', { headers: { Authorization: adminOf('prov'), 'x-tenant-id': 'hosp' } });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'FORBIDDEN_CROSS_TENANT');
  });
});

describe('PUT /api/v1/my-tenant keeps rejecting capabilities (task 6.6)', () => {
  it('capabilities in the body are an unknown field: 400 and nothing is updated', async () => {
    TenantService.update = async (...args) => { updateCalls.push(args); return {}; };
    const { status, body } = await req('PUT', '/api/v1/my-tenant', {
      headers: { Authorization: adminOf('prov') },
      body: { name: 'Nuevo', capabilities: { executesServices: false, registersExternal: true } },
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(updateCalls.length, 0);
  });

  it('organizationCustomerId is rejected as well', async () => {
    TenantService.update = async (...args) => { updateCalls.push(args); return {}; };
    const { status } = await req('PUT', '/api/v1/my-tenant', {
      headers: { Authorization: adminOf('prov') },
      body: { organizationCustomerId: '507f1f77bcf86cd799439099' },
    });
    assert.equal(status, 400);
    assert.equal(updateCalls.length, 0);
  });
});

describe('PATCH /api/v1/platform/tenants/:id/capabilities', () => {
  const url = `/api/v1/platform/tenants/${TENANT_MONGO_ID}/capabilities`;
  let calls;
  beforeEach(() => {
    calls = [];
    PlatformTenantService.updateCapabilities = async (...args) => {
      calls.push(args);
      return { tenantId: 'x', capabilities: { executesServices: true, registersExternal: true }, type: 'hybrid', organizationCustomerId: null };
    };
  });

  it('a superadmin applies a preset', async () => {
    const { status, body } = await req('PATCH', url, { headers: { Authorization: superadmin() }, body: { type: 'hybrid' } });
    assert.equal(status, 200);
    assert.equal(body.data.type, 'hybrid');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], TENANT_MONGO_ID);
    assert.deepEqual(calls[0][1], { type: 'hybrid' });
  });

  it('flags are forwarded to the service', async () => {
    const { status } = await req('PATCH', url, { headers: { Authorization: superadmin() }, body: { executesServices: false, registersExternal: true } });
    assert.equal(status, 200);
    assert.deepEqual(calls[0][1], { executesServices: false, registersExternal: true });
  });

  it('forwards the chosen organization client', async () => {
    await req('PATCH', url, { headers: { Authorization: superadmin() }, body: { type: 'client', organizationCustomerId: '507f1f77bcf86cd799439077' } });
    assert.equal(calls[0][1].organizationCustomerId, '507f1f77bcf86cd799439077');
  });

  it('a tenant admin cannot (403) and the service is not reached', async () => {
    const { status } = await req('PATCH', url, { headers: { Authorization: adminOf('prov') }, body: { type: 'client' } });
    assert.equal(status, 403);
    assert.equal(calls.length, 0);
  });

  it('unauthenticated is 401', async () => {
    const { status } = await req('PATCH', url, { body: { type: 'client' } });
    assert.equal(status, 401);
    assert.equal(calls.length, 0);
  });

  it('an empty body is 400', async () => {
    const { status, body } = await req('PATCH', url, { headers: { Authorization: superadmin() }, body: {} });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(calls.length, 0);
  });

  it('unknown fields (e.g. tenantId, status) are rejected', async () => {
    for (const bad of [{ type: 'client', tenantId: 'other' }, { type: 'client', status: 'closed' }, { type: 'nope' }, { executesServices: 'maybe' }]) {
      const { status } = await req('PATCH', url, { headers: { Authorization: superadmin() }, body: bad });
      assert.equal(status, 400, JSON.stringify(bad));
    }
    assert.equal(calls.length, 0);
  });

  it('type together with flags is ambiguous: 400', async () => {
    const { status } = await req('PATCH', url, { headers: { Authorization: superadmin() }, body: { type: 'client', registersExternal: true } });
    assert.equal(status, 400);
  });

  it('a service 409 ORGANIZATION_CUSTOMER_REQUIRED reaches the client with its candidates', async () => {
    PlatformTenantService.updateCapabilities = async () => {
      throw new ApiError(409, 'Elige el cliente de la organización', 'ORGANIZATION_CUSTOMER_REQUIRED', { candidates: [{ _id: 'a' }, { _id: 'b' }] });
    };
    const { status, body } = await req('PATCH', url, { headers: { Authorization: superadmin() }, body: { type: 'client' } });
    assert.equal(status, 409);
    assert.equal(body.error.code, 'ORGANIZATION_CUSTOMER_REQUIRED');
    assert.equal(body.error.details.candidates.length, 2);
  });
});
