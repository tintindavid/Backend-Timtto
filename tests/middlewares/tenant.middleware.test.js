/**
 * tests/middlewares/tenant.middleware.test.js
 *
 * Behavior tests for tenantResolver — covers the platform sentinel case
 * discovered post-E0 deploy: '__platform__' must resolve without a DB lookup
 * so the SuperAdmin login flow can complete before req.user is populated.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Tenant } from '../../src/models/tenant.model.js';
import { tenantResolver } from '../../src/middlewares/tenant.middleware.js';

/**
 * Build a minimal Express-like req/res/next triple for middleware unit tests.
 */
function buildContext({ header, user } = {}) {
  const req = {
    headers: header ? { 'x-tenant-id': header } : {},
    user,
  };
  const res = {};
  const errors = [];
  const next = (err) => { if (err) errors.push(err); };
  return { req, res, next, errors };
}

const ALL_ENABLED = { executesServices: true, registersExternal: true, usesQrs: true, scheduleQuickLoad: true, usesInventoryBasic: true, usesInventoryAdvanced: true };

describe('tenantResolver — platform sentinel', () => {
  const originalFindOne = Tenant.findOne;
  afterEach(() => { Tenant.findOne = originalFindOne; });

  it("accepts '__platform__' without a DB lookup (SuperAdmin login path)", async () => {
    let dbCalled = false;
    Tenant.findOne = () => {
      dbCalled = true;
      return { lean: () => Promise.resolve(null) };
    };

    const { req, res, next, errors } = buildContext({ header: '__platform__' });
    await tenantResolver(req, res, next);

    assert.equal(dbCalled, false, 'DB lookup must be bypassed for the sentinel');
    assert.equal(errors.length, 0, 'no error should be raised');
    assert.equal(req.tenantId, '__platform__');
    assert.deepEqual(req.tenant, { tenantId: '__platform__', status: 'active', capabilities: ALL_ENABLED });
  });

  it("normalizes header casing to lowercase before comparing to sentinel", async () => {
    let dbCalled = false;
    Tenant.findOne = () => {
      dbCalled = true;
      return { lean: () => Promise.resolve(null) };
    };

    const { req, res, next, errors } = buildContext({ header: '__PLATFORM__' });
    await tenantResolver(req, res, next);

    assert.equal(dbCalled, false);
    assert.equal(errors.length, 0);
    assert.equal(req.tenantId, '__platform__');
  });

  it('still performs the DB lookup for a real tenantId', async () => {
    let capturedFilter = null;
    Tenant.findOne = (filter) => {
      capturedFilter = filter;
      return { lean: () => Promise.resolve({ tenantId: 'clinicaxyz', status: 'active' }) };
    };

    const { req, res, next, errors } = buildContext({ header: 'clinicaxyz' });
    await tenantResolver(req, res, next);

    assert.deepEqual(capturedFilter, { tenantId: 'clinicaxyz' });
    assert.equal(errors.length, 0);
    assert.equal(req.tenantId, 'clinicaxyz');
    assert.equal(req.tenant.status, 'active');
  });

  it('returns 404 for a non-sentinel tenantId that does not exist', async () => {
    Tenant.findOne = () => ({ lean: () => Promise.resolve(null) });

    const { req, res, next, errors } = buildContext({ header: 'no-existe' });
    await tenantResolver(req, res, next);

    assert.equal(errors.length, 1);
    assert.equal(errors[0].statusCode, 404);
    assert.equal(errors[0].code, 'TENANT_NOT_FOUND');
  });

  it('ignores req.body.tenantId — invariant from constitution P1', async () => {
    let dbCalled = false;
    Tenant.findOne = () => {
      dbCalled = true;
      return { lean: () => Promise.resolve(null) };
    };

    const { req, res, next } = buildContext({});
    req.body = { tenantId: 'evil-tenant' };
    await tenantResolver(req, res, next);

    assert.equal(dbCalled, false, 'body.tenantId must NOT trigger a DB lookup');
    assert.equal(req.tenantId, undefined, 'body.tenantId must be ignored');
  });
});

describe('tenantResolver — capabilities (tenant-capabilities-hybrid-mode)', () => {
  const originalFindOne = Tenant.findOne;
  afterEach(() => { Tenant.findOne = originalFindOne; });

  it('projects capabilities in the single tenant query', async () => {
    let calls = 0;
    let projection = null;
    Tenant.findOne = (_filter, proj) => {
      calls += 1;
      projection = proj;
      return { lean: () => Promise.resolve({ tenantId: 'clinicaxyz', status: 'active' }) };
    };
    const { req, res, next } = buildContext({ header: 'clinicaxyz' });
    await tenantResolver(req, res, next);
    assert.equal(calls, 1);
    assert.equal(projection.capabilities, 1);
    assert.equal(projection.tenantId, 1);
    assert.equal(projection.status, 1);
  });

  it('normalizes a legacy tenant without the field to the provider defaults', async () => {
    Tenant.findOne = () => ({ lean: () => Promise.resolve({ tenantId: 'old', status: 'active' }) });
    const { req, res, next } = buildContext({ header: 'old' });
    await tenantResolver(req, res, next);
    assert.deepEqual(req.tenant.capabilities, { executesServices: true, registersExternal: false, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
  });

  it('exposes the stored capabilities of a client tenant', async () => {
    Tenant.findOne = () => ({
      lean: () => Promise.resolve({
        tenantId: 'hosp', status: 'active', capabilities: { executesServices: false, registersExternal: true },
      }),
    });
    const { req, res, next } = buildContext({ header: 'hosp' });
    await tenantResolver(req, res, next);
    assert.deepEqual(req.tenant.capabilities, { executesServices: false, registersExternal: true, usesQrs: false, scheduleQuickLoad: false, usesInventoryBasic: false, usesInventoryAdvanced: false });
    assert.equal(req.tenant.status, 'active');
  });

  it('superadmin (view-as) gets everything enabled without a lookup', async () => {
    let dbCalled = false;
    Tenant.findOne = () => { dbCalled = true; return { lean: () => Promise.resolve(null) }; };
    const { req, res, next } = buildContext({ header: 'hosp', user: { role: 'superadmin', tenantId: '__platform__' } });
    await tenantResolver(req, res, next);
    assert.equal(dbCalled, false);
    assert.deepEqual(req.tenant, { tenantId: 'hosp', status: 'active', capabilities: ALL_ENABLED });
  });
});

