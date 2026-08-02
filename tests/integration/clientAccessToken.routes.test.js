/**
 * tests/integration/clientAccessToken.routes.test.js
 *
 * "Integration" tests for the /api/client-tokens admin surface.
 *
 * This project has no supertest/mongodb-memory-server dependency (see
 * package.json) — the established convention (tests/auth.me.test.js,
 * tests/rbac.middleware.test.js) is to exercise the real middleware/dto/
 * controller chain with fake req/res/next objects, mocking only the service
 * singleton (the DB boundary). We follow that convention here: each test
 * drives requireRole -> validate(dto) -> controller.<method> in sequence,
 * the same order the route file wires them (see src/routes/clientAccessToken.routes.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { clientAccessTokenController } from '../../src/controllers/clientAccessToken.controller.js';
import { clientAccessTokenService } from '../../src/services/clientAccessToken.service.js';
import { requireRole } from '../../src/middlewares/requireRole.middleware.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import {
  createClientAccessTokenDto,
  queryClientAccessTokensDto,
} from '../../src/dtos/clientAccessToken.dto.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const CLIENTE_ID = '507f1f77bcf86cd799439011';
const OT_ID_1 = '507f1f77bcf86cd799439012';
const OT_ID_2 = '507f1f77bcf86cd799439013';

function buildRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    set() { return this; },
  };
}

describe('POST /api/client-tokens', () => {
  afterEach(() => { delete clientAccessTokenService.create; });

  it('happy path: admin body passes the DTO validator and the controller returns 201 { id, token, url }', async () => {
    let capturedArgs = null;
    clientAccessTokenService.create = async (body, tenantId, userId) => {
      capturedArgs = { body, tenantId, userId };
      return { id: 'tok-1', token: 'x'.repeat(32), url: 'http://localhost:5173/portal/xxxx' };
    };

    const req = {
      body: { clienteId: CLIENTE_ID, otIds: [OT_ID_1, OT_ID_2] },
      tenantId: 'tenant-1',
      user: { userId: 'admin-1', role: 'admin' },
    };
    const res = buildRes();

    let roleErr = null;
    requireRole('admin')(req, res, (err) => { roleErr = err; });
    assert.equal(roleErr, undefined);

    let validatorErr = null;
    validate(createClientAccessTokenDto, 'body')(req, res, (err) => { validatorErr = err; });
    assert.equal(validatorErr, undefined);

    await clientAccessTokenController.create(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data, { id: 'tok-1', token: 'x'.repeat(32), url: 'http://localhost:5173/portal/xxxx' });
    assert.deepEqual(capturedArgs.body, { clienteId: CLIENTE_ID, otIds: [OT_ID_1, OT_ID_2] });
    assert.equal(capturedArgs.tenantId, 'tenant-1');
    assert.equal(capturedArgs.userId, 'admin-1');
  });

  it('returns 400 USER_SIGNATURE_MISSING when the admin has no fileFirma', async () => {
    clientAccessTokenService.create = async () => {
      throw new ApiError(400, 'Tu perfil no tiene firma cargada.', 'USER_SIGNATURE_MISSING');
    };
    const req = { body: { clienteId: CLIENTE_ID, otIds: [OT_ID_1] }, tenantId: 'tenant-1', user: { userId: 'admin-1' } };
    const res = buildRes();
    let capturedErr = null;
    await clientAccessTokenController.create(req, res, (err) => { capturedErr = err; });
    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'USER_SIGNATURE_MISSING');
  });

  it('returns 400 OT_CLIENT_MISMATCH when otIds mix clients', async () => {
    clientAccessTokenService.create = async () => {
      throw new ApiError(400, 'Todas las OT deben pertenecer al mismo cliente', 'OT_CLIENT_MISMATCH');
    };
    const req = { body: { clienteId: CLIENTE_ID, otIds: [OT_ID_1, OT_ID_2] }, tenantId: 'tenant-1', user: { userId: 'admin-1' } };
    const res = buildRes();
    let capturedErr = null;
    await clientAccessTokenController.create(req, res, (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'OT_CLIENT_MISMATCH');
  });

  it('returns 400 VALIDATION_ERROR when the body has unknown fields or missing otIds', () => {
    const req1 = { body: { clienteId: CLIENTE_ID, otIds: [OT_ID_1], extra: 'nope' } };
    let err1 = null;
    validate(createClientAccessTokenDto, 'body')(req1, buildRes(), (err) => { err1 = err; });
    assert.ok(err1 instanceof ApiError);
    assert.equal(err1.statusCode, 400);
    assert.equal(err1.code, 'VALIDATION_ERROR');

    const req2 = { body: { clienteId: CLIENTE_ID, otIds: [] } };
    let err2 = null;
    validate(createClientAccessTokenDto, 'body')(req2, buildRes(), (err) => { err2 = err; });
    assert.equal(err2.code, 'VALIDATION_ERROR');
  });

  it('returns 403 FORBIDDEN for role technician before the controller/service ever run', () => {
    const req = { user: { userId: 'u1', role: 'technician' } };
    let serviceCalled = false;
    clientAccessTokenService.create = async () => { serviceCalled = true; };

    let capturedErr = null;
    requireRole('admin')(req, buildRes(), (err) => { capturedErr = err; });

    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 403);
    assert.equal(capturedErr.code, 'FORBIDDEN');
    assert.equal(serviceCalled, false);
  });
});

describe('GET /api/client-tokens', () => {
  afterEach(() => { delete clientAccessTokenService.listByTenant; });

  it('validates clienteId/status/page/limit and returns a paginated list', async () => {
    let capturedArgs = null;
    clientAccessTokenService.listByTenant = async (filters, pagination, tenantId) => {
      capturedArgs = { filters, pagination, tenantId };
      return {
        data: [{ _id: 'tok-1', clienteId: CLIENTE_ID, status: 'active', accessCount: 3, lastAccessedAt: null }],
        pagination: { page: 1, limit: 20, total: 1, pages: 1, hasNext: false, hasPrev: false },
      };
    };

    const req = { query: { clienteId: CLIENTE_ID, status: 'active' }, tenantId: 'tenant-1' };
    let validatorErr = null;
    validate(queryClientAccessTokensDto, 'query')(req, buildRes(), (err) => { validatorErr = err; });
    assert.equal(validatorErr, undefined);

    const res = buildRes();
    await clientAccessTokenController.list(req, res, (err) => { throw err; });

    assert.equal(res.body.success, true);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.pagination.total, 1);
    assert.equal(capturedArgs.tenantId, 'tenant-1');
    assert.equal(capturedArgs.filters.clienteId, CLIENTE_ID);
    assert.equal(capturedArgs.filters.status, 'active');
  });

  it('rejects an invalid status value at the DTO layer', () => {
    const req = { query: { status: 'bogus' } };
    let capturedErr = null;
    validate(queryClientAccessTokensDto, 'query')(req, buildRes(), (err) => { capturedErr = err; });
    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'VALIDATION_ERROR');
  });
});

describe('GET /api/client-tokens/:id', () => {
  afterEach(() => { delete clientAccessTokenService.getById; });

  it('returns the populated token document for the caller tenant', async () => {
    clientAccessTokenService.getById = async (id, tenantId) => {
      assert.equal(tenantId, 'tenant-1');
      return { _id: id, otIds: [{ Consecutivo: 'OT-1', EstadoOt: 'Abierta', Avance: 50 }], createdBy: { fullName: 'Admin One' } };
    };
    const req = { params: { id: 'tok-1' }, tenantId: 'tenant-1' };
    const res = buildRes();
    await clientAccessTokenController.getById(req, res, (err) => { throw err; });
    assert.equal(res.body.data._id, 'tok-1');
    assert.equal(res.body.data.createdBy.fullName, 'Admin One');
  });

  it('returns 404 for a cross-tenant token (no existence leak)', async () => {
    clientAccessTokenService.getById = async () => {
      throw new ApiError(404, 'Acceso no encontrado', 'NOT_FOUND');
    };
    const req = { params: { id: 'tok-1' }, tenantId: 'tenant-B' };
    const res = buildRes();
    let capturedErr = null;
    await clientAccessTokenController.getById(req, res, (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'NOT_FOUND');
  });
});

describe('PATCH /api/client-tokens/:id/revoke', () => {
  afterEach(() => { delete clientAccessTokenService.revoke; });

  it('returns 200 with the updated document on first revoke', async () => {
    clientAccessTokenService.revoke = async (id, tenantId, revokedBy) => ({
      _id: id, status: 'revoked', revokedAt: new Date().toISOString(), revokedBy,
    });
    const req = { params: { id: 'tok-1' }, tenantId: 'tenant-1', user: { userId: 'admin-1' } };
    const res = buildRes();
    await clientAccessTokenController.revoke(req, res, (err) => { throw err; });
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'revoked');
  });

  it('returns 409 TOKEN_ALREADY_REVOKED on a second revoke call', async () => {
    clientAccessTokenService.revoke = async () => {
      throw new ApiError(409, 'El acceso ya fue revocado', 'TOKEN_ALREADY_REVOKED');
    };
    const req = { params: { id: 'tok-1' }, tenantId: 'tenant-1', user: { userId: 'admin-1' } };
    const res = buildRes();
    let capturedErr = null;
    await clientAccessTokenController.revoke(req, res, (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'TOKEN_ALREADY_REVOKED');
  });
});

describe('DELETE /api/client-tokens/:id', () => {
  afterEach(() => { delete clientAccessTokenService.softDelete; });

  it('returns 204 with no body when the token is revoked', async () => {
    clientAccessTokenService.softDelete = async () => undefined;
    const req = { params: { id: 'tok-1' }, tenantId: 'tenant-1' };
    const res = buildRes();
    await clientAccessTokenController.softDelete(req, res, (err) => { throw err; });
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, undefined);
  });

  it('returns 409 TOKEN_MUST_BE_REVOKED_FIRST when the token is still active', async () => {
    clientAccessTokenService.softDelete = async () => {
      throw new ApiError(409, 'El acceso debe estar revocado antes de eliminarlo', 'TOKEN_MUST_BE_REVOKED_FIRST');
    };
    const req = { params: { id: 'tok-1' }, tenantId: 'tenant-1' };
    const res = buildRes();
    let capturedErr = null;
    await clientAccessTokenController.softDelete(req, res, (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'TOKEN_MUST_BE_REVOKED_FIRST');
  });
});
