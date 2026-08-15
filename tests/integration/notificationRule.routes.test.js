/**
 * tests/integration/notificationRule.routes.test.js
 *
 * "Integration" tests for /api/v1/notification-rules, following the project
 * convention (see tests/integration/clientAccessToken.routes.test.js): no
 * supertest/mongodb-memory-server — drive requireRole -> validate(dto) ->
 * controller.<method> in sequence with fake req/res objects, mocking only
 * the service singleton (the DB boundary).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { notificationRuleController } from '../../src/controllers/notificationRule.controller.js';
import { notificationRuleService } from '../../src/services/notificationRule.service.js';
import { requireRole } from '../../src/middlewares/requireRole.middleware.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { createNotificationRuleDto, updateNotificationRuleDto } from '../../src/dtos/notificationRule.dto.js';
import { ApiError } from '../../src/utils/apiError.util.js';

function buildRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

describe('POST /api/v1/notification-rules', () => {
  afterEach(() => { delete notificationRuleService.create; });

  it('admin creates a rule: passes the DTO and returns 201', async () => {
    let captured = null;
    notificationRuleService.create = async (body, tenantId) => {
      captured = { body, tenantId };
      return { _id: 'rule-1', tenantId, ...body };
    };

    const req = {
      body: { event: 'system.test', recipients: { roles: ['admin'], userIds: [] }, channels: ['inapp'], enabled: true },
      tenantId: 'tenant-1',
      user: { userId: 'admin-1', role: 'admin' },
    };
    const res = buildRes();

    let roleErr = null;
    requireRole('admin')(req, res, (err) => { roleErr = err; });
    assert.equal(roleErr, undefined);

    let validatorErr = null;
    validate(createNotificationRuleDto, 'body')(req, res, (err) => { validatorErr = err; });
    assert.equal(validatorErr, undefined);

    await notificationRuleController.create(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(captured.tenantId, 'tenant-1');
    assert.equal(captured.body.event, 'system.test');
  });

  it('non-admin (technician) is denied before the service runs', () => {
    const req = { user: { userId: 'u1', role: 'technician' } };
    let serviceCalled = false;
    notificationRuleService.create = async () => { serviceCalled = true; };

    let capturedErr = null;
    requireRole('admin')(req, buildRes(), (err) => { capturedErr = err; });

    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 403);
    assert.equal(serviceCalled, false);
  });

  it('unique conflict (tenantId, event): returns 409', async () => {
    notificationRuleService.create = async () => {
      throw new ApiError(409, 'Ya existe una regla configurada para el evento "system.test"', 'RULE_ALREADY_EXISTS');
    };
    const req = {
      body: { event: 'system.test' },
      tenantId: 'tenant-1',
      user: { userId: 'admin-1', role: 'admin' },
    };
    const res = buildRes();
    let capturedErr = null;
    await notificationRuleController.create(req, res, (err) => { capturedErr = err; });

    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'RULE_ALREADY_EXISTS');
  });

  it('rejects an unknown event value at the DTO layer', () => {
    const req = { body: { event: 'not.a.real.event' } };
    let capturedErr = null;
    validate(createNotificationRuleDto, 'body')(req, buildRes(), (err) => { capturedErr = err; });
    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'VALIDATION_ERROR');
  });
});

describe('PUT /api/v1/notification-rules/:id', () => {
  afterEach(() => { delete notificationRuleService.update; });

  it('rejects an unknown field (e.g. attempting to change event) at the DTO layer', () => {
    const req = { body: { event: 'system.test', enabled: false } };
    let capturedErr = null;
    validate(updateNotificationRuleDto, 'body')(req, buildRes(), (err) => { capturedErr = err; });
    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.code, 'VALIDATION_ERROR');
  });

  it('updates recipients/channels/enabled and returns 200', async () => {
    notificationRuleService.update = async (id, data, tenantId) => ({ _id: id, tenantId, ...data });
    const req = { params: { id: 'rule-1' }, body: { enabled: false }, tenantId: 'tenant-1' };
    const res = buildRes();
    await notificationRuleController.update(req, res, (err) => { throw err; });
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.enabled, false);
  });
});

describe('DELETE /api/v1/notification-rules/:id', () => {
  afterEach(() => { delete notificationRuleService.remove; });

  it('soft-deletes the rule and returns 204 with no body', async () => {
    notificationRuleService.remove = async () => undefined;
    const req = { params: { id: 'rule-1' }, tenantId: 'tenant-1' };
    const res = buildRes();
    await notificationRuleController.remove(req, res, (err) => { throw err; });
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, undefined);
  });
});
