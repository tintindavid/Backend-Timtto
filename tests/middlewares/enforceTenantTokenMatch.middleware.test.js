/**
 * tests/middlewares/enforceTenantTokenMatch.middleware.test.js
 * enforce-tenant-token-match (spec: tenant-token-binding): unit tests of the guard,
 * tryAuthenticate and the tenantResolver JWT fallback.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Tenant } from '../../src/models/tenant.model.js';
import { enforceTenantTokenMatch } from '../../src/middlewares/enforceTenantTokenMatch.middleware.js';
import { tryAuthenticate } from '../../src/middlewares/tryAuthenticate.middleware.js';
import { tenantResolver } from '../../src/middlewares/tenant.middleware.js';
import { signToken } from '../../src/utils/jwt.util.js';

function ctx({ user, header, method = 'GET', path = '/api/v1/customers' } = {}) {
  const req = { user, method, path, headers: header === undefined ? {} : { 'x-tenant-id': header } };
  const errors = [];
  let nextCalled = false;
  const next = (err) => { nextCalled = true; if (err) errors.push(err); };
  return { req, next, errors, called: () => nextCalled };
}

const admin = (tenantId) => ({ userId: 'u1', role: 'admin', tenantId });

describe('enforceTenantTokenMatch', () => {
  afterEach(() => { delete process.env.ENFORCE_TENANT_TOKEN_MATCH; });

  it('rejects a header that names another tenant with 403 FORBIDDEN_CROSS_TENANT', () => {
    const c = ctx({ user: admin('t1'), header: 't2' });
    enforceTenantTokenMatch(c.req, {}, c.next);
    assert.equal(c.errors.length, 1);
    assert.equal(c.errors[0].statusCode, 403);
    assert.equal(c.errors[0].code, 'FORBIDDEN_CROSS_TENANT');
  });

  it('rejects the other tenant regardless of letter case and whitespace', () => {
    for (const header of ['T2', ' t2 ', 'T2 ']) {
      const c = ctx({ user: admin('t1'), header });
      enforceTenantTokenMatch(c.req, {}, c.next);
      assert.equal(c.errors[0]?.code, 'FORBIDDEN_CROSS_TENANT', `header "${header}"`);
    }
  });

  it('accepts the own tenant in any letter case, and a token tenant stored with capitals', () => {
    for (const [tokenTenant, header] of [['t1', 't1'], ['t1', 'T1'], ['T1', 't1'], ['Clinica', ' clinica ']]) {
      const c = ctx({ user: admin(tokenTenant), header });
      enforceTenantTokenMatch(c.req, {}, c.next);
      assert.equal(c.errors.length, 0, `${tokenTenant} vs ${header}`);
      assert.equal(c.called(), true);
    }
  });

  it('lets a request without header through (the resolver falls back to the token tenant)', () => {
    const c = ctx({ user: admin('t1') });
    enforceTenantTokenMatch(c.req, {}, c.next);
    assert.equal(c.errors.length, 0);
    assert.equal(c.called(), true);
  });

  it('rejects a non-superadmin token without tenantId with 401 TOKEN_TENANT_MISSING', () => {
    for (const user of [{ userId: 'u1', role: 'admin' }, { userId: 'u1', role: 'admin', tenantId: '  ' }]) {
      const c = ctx({ user, header: 't1' });
      enforceTenantTokenMatch(c.req, {}, c.next);
      assert.equal(c.errors[0]?.statusCode, 401);
      assert.equal(c.errors[0]?.code, 'TOKEN_TENANT_MISSING');
    }
  });

  it('never rejects superadmin (view-as and platform sentinel)', () => {
    for (const header of ['t2', '__platform__', undefined]) {
      const c = ctx({ user: { userId: 's1', role: 'superadmin', tenantId: '__platform__' }, header });
      enforceTenantTokenMatch(c.req, {}, c.next);
      assert.equal(c.errors.length, 0, `header ${header}`);
    }
  });

  it('does nothing without req.user', () => {
    const c = ctx({ header: 't2' });
    enforceTenantTokenMatch(c.req, {}, c.next);
    assert.equal(c.errors.length, 0);
    assert.equal(c.called(), true);
  });

  it('exempts pre-authentication auth endpoints but not /auth/me or /auth/change-password', () => {
    for (const [method, path] of [
      ['POST', '/api/v1/auth/login'], ['POST', '/api/v1/auth/register'], ['POST', '/api/v1/auth/refresh-token'],
      ['POST', '/api/v1/auth/forgot-password'], ['POST', '/api/v1/auth/reset-password'],
      ['GET', '/api/v1/auth/validate-reset-token'],
    ]) {
      const c = ctx({ user: admin('t1'), header: 't2', method, path });
      enforceTenantTokenMatch(c.req, {}, c.next);
      assert.equal(c.errors.length, 0, `${method} ${path}`);
    }
    for (const [method, path] of [['GET', '/api/v1/auth/me'], ['POST', '/api/v1/auth/change-password']]) {
      const c = ctx({ user: admin('t1'), header: 't2', method, path });
      enforceTenantTokenMatch(c.req, {}, c.next);
      assert.equal(c.errors[0]?.code, 'FORBIDDEN_CROSS_TENANT', `${method} ${path}`);
    }
  });

  it('is bypassed only by ENFORCE_TENANT_TOKEN_MATCH=off', () => {
    process.env.ENFORCE_TENANT_TOKEN_MATCH = 'off';
    const c = ctx({ user: admin('t1'), header: 't2' });
    enforceTenantTokenMatch(c.req, {}, c.next);
    assert.equal(c.errors.length, 0);
    process.env.ENFORCE_TENANT_TOKEN_MATCH = 'false';
    const d = ctx({ user: admin('t1'), header: 't2' });
    enforceTenantTokenMatch(d.req, {}, d.next);
    assert.equal(d.errors[0]?.code, 'FORBIDDEN_CROSS_TENANT');
  });

  it('ignores a non-string header value', () => {
    const c = ctx({ user: admin('t1') });
    c.req.headers['x-tenant-id'] = ['t2', 't3'];
    enforceTenantTokenMatch(c.req, {}, c.next);
    assert.equal(c.errors.length, 0);
  });
});

describe('tryAuthenticate', () => {
  it('populates req.user from a valid Bearer token', () => {
    const token = signToken({ userId: 'u1', role: 'admin', tenantId: 't1' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    tryAuthenticate(req, {}, () => {});
    assert.equal(req.user.tenantId, 't1');
    assert.equal(req.user.role, 'admin');
  });

  it('ignores invalid tokens and headers without Bearer, and never overwrites req.user', () => {
    const bad = { headers: { authorization: 'Bearer not-a-jwt' } };
    tryAuthenticate(bad, {}, () => {});
    assert.equal(bad.user, undefined);
    const noBearer = { headers: { authorization: 'Basic abc' } };
    tryAuthenticate(noBearer, {}, () => {});
    assert.equal(noBearer.user, undefined);
    const token = signToken({ userId: 'u1', role: 'admin', tenantId: 't1' });
    const preset = { user: { tenantId: 'already' }, headers: { authorization: `Bearer ${token}` } };
    tryAuthenticate(preset, {}, () => {});
    assert.equal(preset.user.tenantId, 'already');
  });
});

describe('tenantResolver with an authenticated user', () => {
  const original = Tenant.findOne;
  afterEach(() => { Tenant.findOne = original; });

  it('uses the token tenant, lowercased, when there is no header (and loads the tenant once)', async () => {
    let lookups = 0;
    let looked;
    Tenant.findOne = (filter) => { lookups += 1; looked = filter; return { lean: () => Promise.resolve({ tenantId: filter.tenantId, status: 'active' }) }; };
    const req = { headers: {}, user: { role: 'admin', tenantId: 'Clinica' }, path: '/api/v1/customers' };
    const errors = [];
    await tenantResolver(req, {}, (e) => { if (e) errors.push(e); });
    assert.equal(errors.length, 0);
    assert.equal(req.tenantId, 'clinica');
    assert.equal(looked.tenantId, 'clinica');
    assert.equal(req.tenant.status, 'active');
    assert.equal(lookups, 1);
  });

  it('keeps the header tenant when it matches, with a single lookup', async () => {
    let lookups = 0;
    Tenant.findOne = (filter) => { lookups += 1; return { lean: () => Promise.resolve({ tenantId: filter.tenantId, status: 'active' }) }; };
    const req = { headers: { 'x-tenant-id': 'T1' }, user: { role: 'admin', tenantId: 't1' }, path: '/x' };
    await tenantResolver(req, {}, () => {});
    assert.equal(req.tenantId, 't1');
    assert.equal(lookups, 1);
  });
});
