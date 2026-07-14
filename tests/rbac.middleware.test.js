import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../src/middlewares/rbac.middleware.js';

describe('rbac middleware — authorize()', () => {
  it('allows when req.user.permissions includes the required permission', () => {
    const req = { user: { userId: 'u1', tenantId: 't1', permissions: ['ots:create', 'ots:read'] } };
    let called = false;
    authorize('ots:create')(req, {}, (err) => {
      if (err) throw err;
      called = true;
    });
    assert.equal(called, true);
  });

  it('denies with 403 FORBIDDEN when permission is missing', () => {
    const req = { user: { userId: 'u1', tenantId: 't1', permissions: ['ots:read'] } };
    let captured = null;
    authorize('ots:create')(req, {}, (err) => {
      captured = err;
    });
    assert.equal(captured.statusCode, 403);
    assert.equal(captured.code, 'FORBIDDEN');
  });

  it('denies with 403 when permissions array is missing entirely', () => {
    const req = { user: { userId: 'u1', tenantId: 't1' } };
    let captured = null;
    authorize('ots:create')(req, {}, (err) => {
      captured = err;
    });
    assert.equal(captured.statusCode, 403);
    assert.equal(captured.code, 'FORBIDDEN');
  });

  it('denies with 401 NOT_AUTHENTICATED when req.user is missing', () => {
    const req = {};
    let captured = null;
    authorize('ots:create')(req, {}, (err) => {
      captured = err;
    });
    assert.equal(captured.statusCode, 401);
    assert.equal(captured.code, 'NOT_AUTHENTICATED');
  });

  it('bypasses check when user.role === superadmin (platform operator)', () => {
    const req = { user: { userId: 'u1', role: 'superadmin', permissions: [] } };
    let called = false;
    authorize('ots:create')(req, {}, (err) => {
      if (err) throw err;
      called = true;
    });
    assert.equal(called, true);
  });
});
