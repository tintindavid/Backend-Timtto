import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../src/middlewares/rbac.middleware.js';
import { Role } from '../src/models/role.model.js';

describe('rbac middleware', () => {
  afterEach(() => {
    delete Role.findOne;
  });

  it('allows access when the role contains the required permission', async () => {
    Role.findOne = async () => ({ permissions: ['ot:create'] });

    const req = { user: { userId: 'user-1', tenantId: 'tenant-1', roleId: 'role-1' } };
    let nextCalled = false;
    const next = (error) => {
      if (error) throw error;
      nextCalled = true;
    };

    await authorize('ot:create')(req, {}, next);

    assert.equal(nextCalled, true);
  });

  it('denies access when the user has no role assigned', async () => {
    const req = { user: { userId: 'user-1', tenantId: 'tenant-1', roleId: null } };
    let capturedError = null;
    const next = (error) => { capturedError = error; };

    await authorize('ot:create')(req, {}, next);

    assert.equal(capturedError.statusCode, 403);
    assert.equal(capturedError.code, 'NO_ROLE_ASSIGNED');
  });

  it('denies access when permission is missing', async () => {
    Role.findOne = async () => ({ permissions: ['reports:read'] });

    const req = { user: { userId: 'user-1', tenantId: 'tenant-1', roleId: 'role-1' } };
    let capturedError = null;
    const next = (error) => { capturedError = error; };

    await authorize('ot:create')(req, {}, next);

    assert.equal(capturedError.statusCode, 403);
    assert.equal(capturedError.code, 'FORBIDDEN');
  });
});