import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { authController } from '../src/controllers/auth.controller.js';
import { userService } from '../src/services/user.service.js';
import { ApiError } from '../src/utils/apiError.util.js';

describe('authController.me', () => {
  afterEach(() => {
    delete userService.getById;
  });

  it('looks up the current user with both userId and tenantId', async () => {
    let calledWith = null;
    userService.getById = async (userId, tenantId) => {
      calledWith = { userId, tenantId };
      return { _id: userId, tenantId, email: 'user@example.com' };
    };

    const req = { user: { userId: 'user-1', tenantId: 'tenant-1' } };
    const res = { jsonPayload: null, json(payload) { this.jsonPayload = payload; } };
    const next = (error) => { throw error; };

    await authController.me(req, res, next);

    assert.deepEqual(calledWith, { userId: 'user-1', tenantId: 'tenant-1' });
    assert.equal(res.jsonPayload.message, 'Usuario actual');
    assert.equal(res.jsonPayload.data._id, 'user-1');
  });

  it('returns 401 when tenantId is missing from the token and request', async () => {
    const originalGetById = userService.getById;
    userService.getById = async () => ({ _id: 'user-1' });

    const req = { user: { userId: 'user-1' } };
    const res = { json() { throw new Error('json should not be called'); } };
    let capturedError = null;
    const next = (error) => { capturedError = error; };

    await authController.me(req, res, next);

    assert.ok(capturedError instanceof ApiError);
    assert.equal(capturedError.statusCode, 401);
    assert.equal(capturedError.code, 'INVALID_TOKEN');

    userService.getById = originalGetById;
  });
});
