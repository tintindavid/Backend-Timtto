/**
 * tests/integration/ot.programacion.routes.test.js
 *
 * "Integration" tests for POST /api/v1/ots/:id/programacion and
 * GET /api/v1/ots/:id/programaciones (ot-responsables-programacion-trazable,
 * tasks.md 7.4). Following the project convention (see
 * tests/integration/notificationRule.routes.test.js): no supertest/mongodb-
 * memory-server — drive authorize -> validate(dto) -> controller.<method> in
 * sequence with fake req/res objects, mocking only the service singleton
 * (the DB boundary).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { oTController } from '../../src/controllers/ot.controller.js';
import { oTService } from '../../src/services/ot.service.js';
import { authorize } from '../../src/middlewares/rbac.middleware.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { setProgramacionOtDto } from '../../src/dtos/setProgramacionOt.dto.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { ApiError } from '../../src/utils/apiError.util.js';

function buildRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const FUTURE_START = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const FUTURE_END = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const USER_A = '507f1f77bcf86cd799439021';
const OT_ID = '507f1f77bcf86cd799439010';

describe('POST /api/v1/ots/:id/programacion', () => {
  afterEach(() => { delete oTService.setProgramacion; });

  it('admin with ots:manage-responsables: 201 with the new entry', async () => {
    let captured = null;
    oTService.setProgramacion = async (args) => {
      captured = args;
      return { _id: 'entry-1', isActive: true, responsables: [{ userId: USER_A, snapshotName: 'T. User' }] };
    };

    const req = {
      params: { id: OT_ID },
      body: { fechaInicio: FUTURE_START, fechaFin: FUTURE_END, responsableUserIds: [USER_A] },
      tenantId: 'tenant-1',
      user: { userId: 'admin-1', role: 'admin', permissions: [PERMISSIONS.OTS_MANAGE_RESPONSABLES] },
    };
    const res = buildRes();

    let authErr;
    authorize(PERMISSIONS.OTS_MANAGE_RESPONSABLES)(req, res, (err) => { authErr = err; });
    assert.equal(authErr, undefined);

    let validationErr;
    validate(setProgramacionOtDto, 'body')(req, res, (err) => { validationErr = err; });
    assert.equal(validationErr, undefined);

    await oTController.setProgramacion(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.isActive, true);
    assert.equal(captured.otId, OT_ID);
    assert.equal(captured.tenantId, 'tenant-1');
    assert.equal(captured.actor.userId, 'admin-1');
    assert.deepEqual(captured.responsableUserIds, [USER_A]);
  });

  it('technician without ots:manage-responsables is denied before the service runs (403 FORBIDDEN)', () => {
    const req = {
      params: { id: OT_ID },
      body: { fechaInicio: FUTURE_START, fechaFin: FUTURE_END, responsableUserIds: [USER_A] },
      tenantId: 'tenant-1',
      user: { userId: 'tech-1', role: 'technician', permissions: [] },
    };
    let serviceCalled = false;
    oTService.setProgramacion = async () => { serviceCalled = true; };

    let capturedErr;
    authorize(PERMISSIONS.OTS_MANAGE_RESPONSABLES)(req, buildRes(), (err) => { capturedErr = err; });

    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 403);
    assert.equal(serviceCalled, false);
  });

  it('rejects fechaFin <= fechaInicio at the DTO layer before the service runs', () => {
    const req = {
      params: { id: OT_ID },
      body: { fechaInicio: FUTURE_END, fechaFin: FUTURE_START, responsableUserIds: [USER_A] },
      tenantId: 'tenant-1',
      user: { userId: 'admin-1', role: 'admin', permissions: [PERMISSIONS.OTS_MANAGE_RESPONSABLES] },
    };
    let serviceCalled = false;
    oTService.setProgramacion = async () => { serviceCalled = true; };

    let validationErr;
    validate(setProgramacionOtDto, 'body')(req, buildRes(), (err) => { validationErr = err; });

    assert.ok(validationErr instanceof ApiError);
    assert.equal(validationErr.statusCode, 400);
    assert.equal(serviceCalled, false);
  });

  it('rejects an empty responsableUserIds array at the DTO layer', () => {
    const req = {
      params: { id: OT_ID },
      body: { fechaInicio: FUTURE_START, fechaFin: FUTURE_END, responsableUserIds: [] },
      tenantId: 'tenant-1',
      user: { userId: 'admin-1', role: 'admin', permissions: [PERMISSIONS.OTS_MANAGE_RESPONSABLES] },
    };
    let validationErr;
    validate(setProgramacionOtDto, 'body')(req, buildRes(), (err) => { validationErr = err; });
    assert.ok(validationErr instanceof ApiError);
    assert.equal(validationErr.statusCode, 400);
  });

  it('propagates 400 INELIGIBLE_RESPONSABLES from the service unchanged', async () => {
    oTService.setProgramacion = async () => {
      throw new ApiError(400, 'Uno o más responsables no tienen el permiso ots:can-be-responsible', 'INELIGIBLE_RESPONSABLES', {
        ineligibleUserIds: [USER_A],
      });
    };
    const req = {
      params: { id: OT_ID },
      body: { fechaInicio: FUTURE_START, fechaFin: FUTURE_END, responsableUserIds: [USER_A] },
      tenantId: 'tenant-1',
      user: { userId: 'admin-1', role: 'admin' },
    };
    let capturedErr;
    await oTController.setProgramacion(req, buildRes(), (err) => { capturedErr = err; });

    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.code, 'INELIGIBLE_RESPONSABLES');
  });
});

describe('GET /api/v1/ots/:id/programaciones', () => {
  afterEach(() => { delete oTService.getProgramaciones; });

  it('any user with ots:read gets 200 with the history newest-first', async () => {
    const entries = [
      { _id: 'e2', createdAt: new Date('2026-02-01') },
      { _id: 'e1', createdAt: new Date('2026-01-01') },
    ];
    let captured = null;
    oTService.getProgramaciones = async (args) => { captured = args; return entries; };

    const req = { params: { id: OT_ID }, tenantId: 'tenant-1', user: { userId: 'u1', role: 'technician', permissions: [PERMISSIONS.OTS_READ] } };
    const res = buildRes();

    let authErr;
    authorize(PERMISSIONS.OTS_READ)(req, res, (err) => { authErr = err; });
    assert.equal(authErr, undefined);

    await oTController.getProgramaciones(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, null); // controller uses res.json() without explicit status -> defaults to 200 downstream
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data, entries);
    assert.equal(captured.otId, OT_ID);
    assert.equal(captured.tenantId, 'tenant-1');
  });

  it('404 NOT_FOUND for a cross-tenant OT id propagates from the service', async () => {
    oTService.getProgramaciones = async () => {
      throw new ApiError(404, 'OT no encontrada', 'NOT_FOUND', { id: OT_ID });
    };
    const req = { params: { id: OT_ID }, tenantId: 'tenant-2', user: { userId: 'u1' } };
    let capturedErr;
    await oTController.getProgramaciones(req, buildRes(), (err) => { capturedErr = err; });
    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 404);
  });
});
