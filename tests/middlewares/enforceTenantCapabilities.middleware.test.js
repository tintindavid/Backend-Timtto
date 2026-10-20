/**
 * tests/middlewares/enforceTenantCapabilities.middleware.test.js
 * tenant-capabilities-hybrid-mode, task 2.2. The real chain of app.js
 * (tryAuthenticate -> enforceTenantTokenMatch -> tenantResolver -> enforceReadOnlyForSuperadmin ->
 * enforceTenantCapabilities) is driven over HTTP with signed tokens; only Tenant.findOne is stubbed.
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { Tenant } from '../../src/models/tenant.model.js';
import { tryAuthenticate } from '../../src/middlewares/tryAuthenticate.middleware.js';
import { enforceTenantTokenMatch } from '../../src/middlewares/enforceTenantTokenMatch.middleware.js';
import { tenantResolver } from '../../src/middlewares/tenant.middleware.js';
import { enforceReadOnlyForSuperadmin } from '../../src/middlewares/enforceReadOnlyForSuperadmin.middleware.js';
import { enforceTenantCapabilities } from '../../src/middlewares/enforceTenantCapabilities.middleware.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import { CAPABILITY_ROUTE_MAP } from '../../src/config/tenantCapabilities.config.js';
import { signToken } from '../../src/utils/jwt.util.js';

const TENANTS = {
  prov: { tenantId: 'prov', status: 'active' }, // legacy doc: no capabilities field at all
  prov2: { tenantId: 'prov2', status: 'active', capabilities: { executesServices: true, registersExternal: false } },
  hosp: { tenantId: 'hosp', status: 'active', capabilities: { executesServices: false, registersExternal: true } },
  mixed: { tenantId: 'mixed', status: 'active', capabilities: { executesServices: true, registersExternal: true } },
};
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
const PREFIXES = CAPABILITY_ROUTE_MAP.map((e) => e.prefix);

let server;
let base;
let findOneCalls = 0;
const originalFindOne = Tenant.findOne;
const originalFlag = process.env.ENFORCE_TENANT_CAPABILITIES;

before(async () => {
  Tenant.findOne = (filter) => {
    findOneCalls += 1;
    return { lean: () => Promise.resolve(TENANTS[filter.tenantId] ?? null) };
  };
  const app = express();
  app.use(express.json());
  app.use(tryAuthenticate);
  app.use(enforceTenantTokenMatch);
  app.use(tenantResolver);
  app.use(enforceReadOnlyForSuperadmin);
  app.use(enforceTenantCapabilities);
  const reached = (req, res) => res.json({ reached: true, method: req.method });
  for (const prefix of [...PREFIXES, '/api/v1/customers', '/api/v1/informes', '/api/v1/tickets', '/api/v1/repuestos']) app.use(prefix, reached);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Tenant.findOne = originalFindOne;
  if (originalFlag === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES;
  else process.env.ENFORCE_TENANT_CAPABILITIES = originalFlag;
  await new Promise((r) => server.close(r));
});

afterEach(() => { delete process.env.ENFORCE_TENANT_CAPABILITIES; });

const bearer = (payload) => `Bearer ${signToken(payload)}`;
const admin = (tenantId) => bearer({ userId: 'u1', role: 'admin', roleId: 'r1', tenantId });
const call = async (method, path, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : '{}' });
  return { status: res.status, body: await res.json() };
};

describe('enforceTenantCapabilities over HTTP', () => {
  it('a tenant without executesServices gets 403 CAPABILITY_DISABLED on every mapped prefix and mutating method', async () => {
    for (const prefix of PREFIXES) {
      for (const method of MUTATING) {
        const { status, body } = await call(method, `${prefix}/abc`, { Authorization: admin('hosp') });
        assert.equal(status, 403, `${method} ${prefix}`);
        assert.equal(body.error.code, 'CAPABILITY_DISABLED', `${method} ${prefix}`);
        assert.equal(body.success, false);
        assert.match(body.message, /[a-záéíóú]/i);
      }
    }
  });

  it('also denies the bare prefix (collection create) and a different letter case', async () => {
    assert.equal((await call('POST', '/api/v1/ots', { Authorization: admin('hosp') })).status, 403);
    assert.equal((await call('POST', '/API/V1/OTS', { Authorization: admin('hosp') })).status, 403);
    assert.equal((await call('POST', '/api/v1/ots/?x=1', { Authorization: admin('hosp') })).status, 403);
  });

  it('GET passes so history stays readable', async () => {
    for (const prefix of PREFIXES) {
      const { status, body } = await call('GET', `${prefix}/abc`, { Authorization: admin('hosp') });
      assert.equal(status, 200, prefix);
      assert.equal(body.reached, true);
    }
  });

  it('unmapped (common) prefixes are not affected for a client tenant', async () => {
    assert.equal((await call('POST', '/api/v1/informes', { Authorization: admin('hosp') })).status, 200);
    assert.equal((await call('DELETE', '/api/v1/customers/1', { Authorization: admin('hosp') })).status, 200, 'customers are handled in the controller');
  });

  it('provider tenants pass, with or without the stored field', async () => {
    for (const tenant of ['prov', 'prov2', 'mixed']) {
      for (const prefix of PREFIXES) {
        assert.equal((await call('POST', prefix, { Authorization: admin(tenant) })).status, 200, `${tenant} ${prefix}`);
      }
    }
  });

  it('superadmin is untouched by this guard (view-as of a client tenant, read)', async () => {
    const sa = bearer({ userId: 's1', role: 'superadmin', tenantId: '__platform__' });
    const { status } = await call('GET', '/api/v1/ots', { Authorization: sa, 'x-tenant-id': 'hosp' });
    assert.equal(status, 200);
  });

  it('superadmin mutation is still answered by the read-only guard, not by this one', async () => {
    const sa = bearer({ userId: 's1', role: 'superadmin', tenantId: '__platform__' });
    const { status, body } = await call('POST', '/api/v1/ots', { Authorization: sa, 'x-tenant-id': 'hosp' });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'SUPERADMIN_READONLY');
  });

  it('unauthenticated requests pass through (route-level authenticate decides)', async () => {
    const { status } = await call('POST', '/api/v1/ots', { 'x-tenant-id': 'hosp' });
    assert.equal(status, 200);
  });

  it('keeps exactly one tenant query per request', async () => {
    findOneCalls = 0;
    await call('POST', '/api/v1/ots', { Authorization: admin('hosp') });
    assert.equal(findOneCalls, 1);
  });

  it('ENFORCE_TENANT_CAPABILITIES=warn lets the request through', async () => {
    process.env.ENFORCE_TENANT_CAPABILITIES = 'warn';
    const { status, body } = await call('POST', '/api/v1/ots', { Authorization: admin('hosp') });
    assert.equal(status, 200);
    assert.equal(body.reached, true);
  });

  it('ENFORCE_TENANT_CAPABILITIES=off bypasses the guard', async () => {
    process.env.ENFORCE_TENANT_CAPABILITIES = 'off';
    assert.equal((await call('DELETE', '/api/v1/reports/1', { Authorization: admin('hosp') })).status, 200);
  });

  it('an unknown flag value behaves as the strict default (on)', async () => {
    process.env.ENFORCE_TENANT_CAPABILITIES = 'maybe';
    assert.equal((await call('POST', '/api/v1/ots', { Authorization: admin('hosp') })).status, 403);
  });
});

describe('enforceTenantCapabilities: endpoints of common mounts that create OTs and reports', () => {
  it('POST /tickets/work-order and POST /repuestos/ot-from-solicitudes are denied for a client tenant', async () => {
    for (const path of ['/api/v1/tickets/work-order', '/api/v1/repuestos/ot-from-solicitudes']) {
      assert.ok(PREFIXES.includes(path), `${path} must be in the route map`);
      const { status, body } = await call('POST', path, { Authorization: admin('hosp') });
      assert.equal(status, 403, path);
      assert.equal(body.error.code, 'CAPABILITY_DISABLED');
    }
  });

  it('repeated slashes do not skip the guard (Express routes them to the same handler)', async () => {
    for (const path of [
      '/api/v1//ots',
      '/api//v1///ots',
      '/api/v1/tickets//work-order',
      '/api/v1/repuestos//ot-from-solicitudes',
      '/api/v1/reports//abc',
    ]) {
      const { status, body } = await call('POST', path, { Authorization: admin('hosp') });
      assert.equal(status, 403, path);
      assert.equal(body.error.code, 'CAPABILITY_DISABLED', path);
    }
  });

  it('the rest of tickets and spare parts stays open for a client tenant', async () => {
    assert.equal((await call('POST', '/api/v1/tickets', { Authorization: admin('hosp') })).status, 200);
    assert.equal((await call('POST', '/api/v1/repuestos', { Authorization: admin('hosp') })).status, 200);
  });
});

describe('enforceTenantCapabilities: absolute-form request target', () => {
  // `POST http://host/api/v1/ots HTTP/1.1` is routed by Express on its pathname, so the guard must use
  // the same pathname (req.path), not the raw request target.
  const rawPost = (target, token) => new Promise((resolve, reject) => {
    const url = new URL(base);
    const req = http.request(
      { host: url.hostname, port: url.port, method: 'POST', path: target, headers: { Authorization: token, 'Content-Type': 'application/json', Host: url.host } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    req.end('{}');
  });

  it('is denied for a client tenant like the origin-form request', async () => {
    const out = await rawPost(`${base}/api/v1/ots`, admin('hosp'));
    assert.equal(out.status, 403);
    assert.match(out.body, /CAPABILITY_DISABLED/);
  });

  it('is denied on the new mapped endpoints too', async () => {
    const out = await rawPost(`${base}/api/v1/tickets/work-order`, admin('hosp'));
    assert.equal(out.status, 403);
  });

  it('still passes for a provider tenant', async () => {
    const out = await rawPost(`${base}/api/v1/ots`, admin('prov'));
    assert.equal(out.status, 200);
  });
});

describe('enforceTenantCapabilities unit', () => {
  const run = (req) => {
    const out = { err: null, called: false };
    enforceTenantCapabilities(req, {}, (err) => { out.called = true; out.err = err ?? null; });
    return out;
  };

  it('logs the denial with tenant, route and capability (warn mode)', async () => {
    const { logger } = await import('../../src/config/logger.config.js');
    const original = logger.warn;
    const calls = [];
    logger.warn = (...args) => { calls.push(args); };
    try {
      process.env.ENFORCE_TENANT_CAPABILITIES = 'warn';
      const out = run({
        method: 'POST',
        path: '/api/v1/ots',
        originalUrl: '/api/v1/ots?x=1',
        user: { userId: 'u1', role: 'admin', tenantId: 'hosp' },
        tenantId: 'hosp',
        tenant: { tenantId: 'hosp', capabilities: { executesServices: false, registersExternal: true } },
      });
      assert.equal(out.err, null);
      assert.equal(calls.length, 1);
      const meta = calls[0][1];
      assert.equal(meta.tenantId, 'hosp');
      assert.equal(meta.capability, 'executesServices');
      assert.equal(meta.path, '/api/v1/ots');
      assert.equal(meta.method, 'POST');
    } finally {
      logger.warn = original;
    }
  });

  it('denies with a 403 ApiError carrying the capability', () => {
    const out = run({
      method: 'PATCH',
      path: '/api/v1/sheetwork/1',
      originalUrl: '/api/v1/sheetwork/1',
      user: { role: 'admin', tenantId: 'hosp' },
      tenant: { capabilities: { executesServices: false, registersExternal: true } },
    });
    assert.equal(out.err.statusCode, 403);
    assert.equal(out.err.code, 'CAPABILITY_DISABLED');
    assert.equal(out.err.details.capability, 'executesServices');
  });

  it('without req.tenant it falls back to the defaults (allowed)', () => {
    const out = run({ method: 'POST', path: '/api/v1/ots', originalUrl: '/api/v1/ots', user: { role: 'admin', tenantId: 't' } });
    assert.equal(out.err, null);
    assert.equal(out.called, true);
  });
});
