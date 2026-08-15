/**
 * tests/integration/notificationPreference.routes.test.js
 *
 * Cross-user access is structurally impossible for this router: there is no
 * `:userId` param anywhere — every call is scoped to req.tenantId/req.user.userId.
 * These tests assert that scoping, mirroring the project's integration-test
 * convention (fake req/res, service singleton mocked).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { notificationPreferenceController } from '../../src/controllers/notificationPreference.controller.js';
import { notificationPreferenceService } from '../../src/services/notificationPreference.service.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { upsertNotificationPreferenceDto } from '../../src/dtos/notificationPreference.dto.js';
import { ApiError } from '../../src/utils/apiError.util.js';

function buildRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('GET /api/v1/notification-preferences', () => {
  afterEach(() => { delete notificationPreferenceService.listMine; });

  it('only lists the caller own preferences (userId derived from req.user, never a param)', async () => {
    let captured = null;
    notificationPreferenceService.listMine = async (tenantId, userId) => {
      captured = { tenantId, userId };
      return [{ event: 'system.test', mutedChannels: [] }];
    };
    const req = { tenantId: 'tenant-1', user: { userId: 'u1' } };
    const res = buildRes();
    await notificationPreferenceController.list(req, res, (err) => { throw err; });

    assert.equal(res.body.success, true);
    assert.equal(captured.userId, 'u1');
    assert.equal(captured.tenantId, 'tenant-1');
  });
});

describe('PUT /api/v1/notification-preferences', () => {
  afterEach(() => { delete notificationPreferenceService.upsert; });

  it('upserts mutedChannels for the caller and returns the preference', async () => {
    let captured = null;
    notificationPreferenceService.upsert = async (tenantId, userId, body) => {
      captured = { tenantId, userId, body };
      return { tenantId, userId, ...body };
    };
    const req = {
      body: { event: 'system.test', mutedChannels: ['inapp'] },
      tenantId: 'tenant-1',
      user: { userId: 'u1' },
    };
    const res = buildRes();

    let validatorErr = null;
    validate(upsertNotificationPreferenceDto, 'body')(req, res, (err) => { validatorErr = err; });
    assert.equal(validatorErr, undefined);

    await notificationPreferenceController.upsert(req, res, (err) => { throw err; });

    assert.equal(res.body.success, true);
    assert.equal(captured.userId, 'u1');
    assert.deepEqual(captured.body.mutedChannels, ['inapp']);
  });

  it('rejects an unknown event value at the DTO layer', () => {
    const req = { body: { event: 'not.a.real.event', mutedChannels: [] } };
    let capturedErr = null;
    validate(upsertNotificationPreferenceDto, 'body')(req, buildRes(), (err) => { capturedErr = err; });
    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'VALIDATION_ERROR');
  });
});
