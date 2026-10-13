/**
 * tests/isolation/tenant-token-binding.http.test.js
 * enforce-tenant-token-match: the original finding reproduced over HTTP through the real
 * middleware chain used by app.js (tryAuthenticate -> enforceTenantTokenMatch ->
 * tenantResolver) with a route that echoes the effective tenant and a fake data layer
 * that returns documents of the tenant it is asked for. Unlike the other isolation
 * tests, nothing about the token/header relationship is mocked.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { Tenant } from '../../src/models/tenant.model.js';
import { tryAuthenticate } from '../../src/middlewares/tryAuthenticate.middleware.js';
import { enforceTenantTokenMatch } from '../../src/middlewares/enforceTenantTokenMatch.middleware.js';
import { tenantResolver } from '../../src/middlewares/tenant.middleware.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import { applyTenantFilter } from '../../src/utils/tenant.util.js';
import { signToken } from '../../src/utils/jwt.util.js';

const TENANTS = { t1: 'active', t2: 'active', susp: 'suspended' };
const DOCS = [
  { _id: 1, tenantId: 't1', name: 'cliente de t1' },
  { _id: 2, tenantId: 't2', name: 'cliente de t2' },
  { _id: 3, tenantId: 'susp', name: 'cliente suspendido' },
];

let server;
let base;
const originalFindOne = Tenant.findOne;

before(async () => {
  Tenant.findOne = (filter) => ({
    lean: () => Promise.resolve(TENANTS[filter.tenantId] ? { tenantId: filter.tenantId, status: TENANTS[filter.tenantId] } : null),
  });
  const app = express();
  app.use(express.json());
  app.use(tryAuthenticate);
  app.use(enforceTenantTokenMatch);
  app.use(tenantResolver);
  // Mimics a domain route: the query is scoped with the effective tenant exactly like the services do.
  app.get('/api/v1/customers', (req, res) => {
    const q = applyTenantFilter({}, req.tenantId);
    const data = DOCS.filter((d) => (q.tenantId === undefined ? true : d.tenantId === q.tenantId));
    res.json({ success: true, effectiveTenant: req.tenantId ?? null, data });
  });
  app.post('/api/v1/customers', (req, res) => res.status(201).json({ success: true, createdIn: req.tenantId ?? null }));
  app.post('/api/v1/auth/login', (req, res) => res.json({ success: true, tenant: req.tenantId ?? null }));
  app.get('/public/open', (req, res) => res.json({ success: true, tenant: req.tenantId ?? null }));
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Tenant.findOne = originalFindOne;
  await new Promise((r) => server.close(r));
});

const token = (payload) => `Bearer ${signToken(payload)}`;
const adminT1 = () => token({ userId: 'u1', role: 'admin', roleId: 'r1', tenantId: 't1' });
const get = async (headers, path = '/api/v1/customers') => {
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, body: await res.json() };
};
const tenantsOf = (body) => [...new Set((body.data || []).map((d) => d.tenantId))];

describe('tenant-token-binding over HTTP', () => {
  it('own header: scoped to the token tenant', async () => {
    const { status, body } = await get({ Authorization: adminT1(), 'x-tenant-id': 't1' });
    assert.equal(status, 200);
    assert.deepEqual(tenantsOf(body), ['t1']);
  });

  it('ORIGINAL FINDING: token of t1 with the header of t2 is 403 and returns no data', async () => {
    const { status, body } = await get({ Authorization: adminT1(), 'x-tenant-id': 't2' });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'FORBIDDEN_CROSS_TENANT');
    assert.equal(body.data, undefined);
  });

  it('ORIGINAL FINDING: the other tenant in upper case is also 403', async () => {
    const { status, body } = await get({ Authorization: adminT1(), 'x-tenant-id': 'T2' });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'FORBIDDEN_CROSS_TENANT');
  });

  it('ORIGINAL FINDING: no header is scoped to the token tenant, not to every tenant', async () => {
    const { status, body } = await get({ Authorization: adminT1() });
    assert.equal(status, 200);
    assert.equal(body.effectiveTenant, 't1');
    assert.deepEqual(tenantsOf(body), ['t1']);
  });

  it('own tenant with a different letter case is accepted', async () => {
    const { status, body } = await get({ Authorization: adminT1(), 'x-tenant-id': 'T1' });
    assert.equal(status, 200);
    assert.deepEqual(tenantsOf(body), ['t1']);
  });

  it('a write with the header of another tenant is rejected before the handler runs', async () => {
    const res = await fetch(`${base}/api/v1/customers`, {
      method: 'POST',
      headers: { Authorization: adminT1(), 'x-tenant-id': 't2', 'Content-Type': 'application/json' },
      body: JSON.stringify({ Razonsocial: 'x' }),
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'FORBIDDEN_CROSS_TENANT');
  });

  it('a token without tenantId is 401 TOKEN_TENANT_MISSING', async () => {
    const { status, body } = await get({ Authorization: token({ userId: 'u1', role: 'admin' }), 'x-tenant-id': 't1' });
    assert.equal(status, 401);
    assert.equal(body.error.code, 'TOKEN_TENANT_MISSING');
  });

  it('a foreign header never reaches the tenant lookup, so tenant existence cannot be probed', async () => {
    const real = await get({ Authorization: adminT1(), 'x-tenant-id': 't2' });
    const fake = await get({ Authorization: adminT1(), 'x-tenant-id': 'does-not-exist' });
    assert.equal(real.status, 403);
    assert.equal(fake.status, 403);
  });

  it('superadmin view-as: the header tenant is honoured', async () => {
    const sa = token({ userId: 's1', role: 'superadmin', tenantId: '__platform__' });
    const { status, body } = await get({ Authorization: sa, 'x-tenant-id': 't2' });
    assert.equal(status, 200);
    assert.deepEqual(tenantsOf(body), ['t2']);
  });

  it('superadmin without header stays on the platform sentinel and sees no tenant data', async () => {
    const sa = token({ userId: 's1', role: 'superadmin', tenantId: '__platform__' });
    const { body } = await get({ Authorization: sa });
    assert.equal(body.effectiveTenant, '__platform__');
    assert.deepEqual(tenantsOf(body), []);
  });

  it('login is exempt even with a stale token of another tenant', async () => {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { Authorization: adminT1(), 'x-tenant-id': 't2', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).tenant, 't2');
  });

  it('unauthenticated requests keep working exactly as before', async () => {
    const res = await fetch(`${base}/public/open`, { headers: { 'x-tenant-id': 't2' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).tenant, 't2');
  });

  it('a no-header request of a suspended tenant has its status resolved from the token', async () => {
    const suspended = token({ userId: 'u9', role: 'admin', roleId: 'r1', tenantId: 'susp' });
    const { status, body } = await get({ Authorization: suspended });
    assert.equal(status, 200);
    assert.equal(body.effectiveTenant, 'susp');
  });
});
