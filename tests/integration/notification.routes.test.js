/**
 * tests/integration/notification.routes.test.js
 *
 * Integration tests for /api/v1/notifications (history/unread-count/mark-as-read/test),
 * following the project's fake req/res + mocked-service-singleton convention.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { notificationController } from '../../src/controllers/notification.controller.js';
import { notificationService } from '../../src/services/notification.service.js';
import { NotificationRule } from '../../src/models/notificationRule.model.js';
import { requireRole } from '../../src/middlewares/requireRole.middleware.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { queryNotificationsDto } from '../../src/dtos/notification.dto.js';
import { ApiError } from '../../src/utils/apiError.util.js';

function buildRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const stubs = {};
function stub(target, key, value) {
  if (!(key in stubs)) stubs[key] = [];
  stubs[key].push([target, key, target[key]]);
  target[key] = value;
}
function restoreStubs() {
  for (const key of Object.keys(stubs)) {
    for (const [target, k, original] of stubs[key]) target[k] = original;
  }
  for (const key of Object.keys(stubs)) delete stubs[key];
}

describe('GET /api/v1/notifications', () => {
  afterEach(() => { delete notificationService.list; });

  it('a user only sees their own notifications, paginated', async () => {
    let captured = null;
    notificationService.list = async (args) => {
      captured = args;
      return { data: [{ _id: 'n1', userId: args.userId }], pagination: { page: 1, limit: 20, total: 1, pages: 1, hasNext: false, hasPrev: false } };
    };

    const req = { query: { page: '1', limit: '20' }, tenantId: 'tenant-1', user: { userId: 'u1' } };
    let validatorErr = null;
    validate(queryNotificationsDto, 'query')(req, buildRes(), (err) => { validatorErr = err; });
    assert.equal(validatorErr, undefined);

    const res = buildRes();
    await notificationController.list(req, res, (err) => { throw err; });

    assert.equal(res.body.success, true);
    assert.equal(captured.userId, 'u1');
    assert.equal(captured.tenantId, 'tenant-1');
    assert.equal(res.body.data[0].userId, 'u1');
  });

  it('filters unread=true through to the service', async () => {
    let captured = null;
    notificationService.list = async (args) => { captured = args; return { data: [], pagination: {} }; };
    const req = { query: { unread: 'true' }, tenantId: 'tenant-1', user: { userId: 'u1' } };
    validate(queryNotificationsDto, 'query')(req, buildRes(), (err) => { if (err) throw err; });
    await notificationController.list(req, buildRes(), (err) => { throw err; });
    assert.equal(captured.unread, true);
  });
});

describe('GET /api/v1/notifications/unread-count', () => {
  afterEach(() => { delete notificationService.unreadCount; });

  it('returns { count } for the caller', async () => {
    notificationService.unreadCount = async ({ userId }) => ({ count: userId === 'u1' ? 3 : 0 });
    const req = { tenantId: 'tenant-1', user: { userId: 'u1' } };
    const res = buildRes();
    await notificationController.unreadCount(req, res, (err) => { throw err; });
    assert.equal(res.body.data.count, 3);
  });
});

describe('POST /api/v1/notifications/:id/read', () => {
  afterEach(() => { delete notificationService.markAsRead; });

  it('marks as read and returns 200', async () => {
    notificationService.markAsRead = async ({ notificationId }) => ({ _id: notificationId, readAt: new Date().toISOString() });
    const req = { params: { id: 'n1' }, tenantId: 'tenant-1', user: { userId: 'u1' } };
    const res = buildRes();
    await notificationController.markAsRead(req, res, (err) => { throw err; });
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.readAt);
  });

  it('is idempotent: marking an already-read notification does not change readAt (service-level contract)', async () => {
    const fixedReadAt = '2026-01-01T00:00:00.000Z';
    notificationService.markAsRead = async () => ({ _id: 'n1', readAt: fixedReadAt });
    const req = { params: { id: 'n1' }, tenantId: 'tenant-1', user: { userId: 'u1' } };
    const res = buildRes();
    await notificationController.markAsRead(req, res, (err) => { throw err; });
    assert.equal(res.body.data.readAt, fixedReadAt);
  });

  it('cannot mark another user notification: 404 propagated from the service', async () => {
    notificationService.markAsRead = async () => {
      throw new ApiError(404, 'Notificación no encontrada', 'NOT_FOUND');
    };
    const req = { params: { id: 'n2' }, tenantId: 'tenant-1', user: { userId: 'u1' } };
    const res = buildRes();
    let capturedErr = null;
    await notificationController.markAsRead(req, res, (err) => { capturedErr = err; });
    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 404);
  });
});

describe('POST /api/v1/notifications/test', () => {
  afterEach(() => {
    delete notificationService.emit;
    restoreStubs();
  });

  it('non-admin (technician) is denied before the controller runs', () => {
    const req = { user: { userId: 'u1', role: 'technician' } };
    let capturedErr = null;
    requireRole('admin')(req, buildRes(), (err) => { capturedErr = err; });
    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 403);
  });

  it('with a configured rule: dispatches via the bus and responds 202', async () => {
    stub(NotificationRule, 'findOne', () => ({ lean: () => Promise.resolve({ event: 'system.test' }) }));
    let emitArgs = null;
    notificationService.emit = async (tenantId, event, payload) => { emitArgs = { tenantId, event, payload }; return { dispatched: 1 }; };

    const req = { tenantId: 'tenant-1', user: { userId: 'admin-1', role: 'admin' } };
    const res = buildRes();
    await notificationController.test(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 202);
    assert.equal(emitArgs.tenantId, 'tenant-1');
    assert.equal(emitArgs.event, 'system.test');
    assert.equal(emitArgs.payload.triggeredBy, 'admin-1');
  });

  it('without a rule: 409 no_rule_configured, bus never called', async () => {
    stub(NotificationRule, 'findOne', () => ({ lean: () => Promise.resolve(null) }));
    let emitCalled = false;
    notificationService.emit = async () => { emitCalled = true; };

    const req = { tenantId: 'tenant-2', user: { userId: 'admin-2', role: 'admin' } };
    const res = buildRes();
    let capturedErr = null;
    await notificationController.test(req, res, (err) => { capturedErr = err; });

    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'no_rule_configured');
    assert.equal(emitCalled, false);
  });

  it('rate limit: a second call by the same admin within 60s responds 429', async () => {
    stub(NotificationRule, 'findOne', () => ({ lean: () => Promise.resolve({ event: 'system.test' }) }));
    notificationService.emit = async () => ({ dispatched: 1 });

    const req = { tenantId: 'tenant-3', user: { userId: 'admin-ratelimit', role: 'admin' } };
    await notificationController.test(req, buildRes(), (err) => { if (err) throw err; });

    let capturedErr = null;
    await notificationController.test(req, buildRes(), (err) => { capturedErr = err; });

    assert.ok(capturedErr instanceof ApiError);
    assert.equal(capturedErr.statusCode, 429);
  });
});
