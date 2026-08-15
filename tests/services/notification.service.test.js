/**
 * tests/services/notification.service.test.js
 *
 * Unit tests for notificationService.emit — the central bus (design.md D7).
 * Follows the project convention (see tests/services/clientAccessToken.service.test.js):
 * no real MongoDB connection, Mongoose model statics are monkey-patched per
 * test and restored in afterEach.
 *
 * socketBridge.getIO is stubbed the same way (it's a plain mutable object
 * exported specifically for this — see src/socket/index.js).
 *
 * Each test uses a distinct tenantId to avoid interference from the
 * in-process rate limiter (100 emits/60s per tenant) shared at module scope.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { notificationService } from '../../src/services/notification.service.js';
import { Notification } from '../../src/models/notification.model.js';
import { NotificationRule } from '../../src/models/notificationRule.model.js';
import { NotificationPreference } from '../../src/models/notificationPreference.model.js';
import { User } from '../../src/models/user.model.js';
import { socketBridge } from '../../src/socket/index.js';

const ADMIN_1 = '507f1f77bcf86cd799439011';
const ADMIN_2 = '507f1f77bcf86cd799439012';
const EXTRA_USER = '507f1f77bcf86cd799439013';

const stubs = {};
function stub(target, key, value) {
  if (!(key in stubs)) stubs[key] = [];
  stubs[key].push([target, key, target[key]]);
  target[key] = value;
}

/** Chainable Mongoose-query stub: supports .lean() or being awaited directly. */
function mockQuery(result) {
  const q = {
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
  return q;
}

describe('notificationService.emit', () => {
  afterEach(() => {
    for (const key of Object.keys(stubs)) {
      for (const [target, k, original] of stubs[key]) {
        target[k] = original;
      }
    }
    for (const key of Object.keys(stubs)) delete stubs[key];
  });

  it('happy path: dispatches to all resolved recipients, persists a Notification each and emits over the socket', async () => {
    const TENANT = 'tenant-happy';
    stub(NotificationRule, 'findOne', () =>
      mockQuery({ tenantId: TENANT, event: 'system.test', enabled: true, recipients: { roles: ['admin'], userIds: [] }, channels: ['inapp'] })
    );
    stub(User, 'find', () => mockQuery([{ _id: ADMIN_1 }, { _id: ADMIN_2 }]));
    stub(NotificationPreference, 'find', () => mockQuery([]));

    const created = [];
    stub(Notification, 'create', async (doc) => {
      const saved = { ...doc, _id: `n-${created.length}`, toObject: () => ({ ...doc, _id: `n-${created.length}` }) };
      created.push(saved);
      return saved;
    });

    const emitted = [];
    const fakeIo = { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
    stub(socketBridge, 'getIO', () => fakeIo);

    const result = await notificationService.emit(TENANT, 'system.test', { triggeredBy: 'x' });

    assert.equal(result.dispatched, 2);
    assert.deepEqual(result.recipients.sort(), [ADMIN_1, ADMIN_2].sort());
    assert.equal(created.length, 2);
    assert.equal(emitted.length, 2);
    assert.ok(emitted.some((e) => e.room === `user:${ADMIN_1}` && e.event === 'notification'));
    assert.ok(emitted.some((e) => e.room === `user:${ADMIN_2}` && e.event === 'notification'));
  });

  it('no matching rule: silent no-op, nothing persisted, nothing emitted, does not throw', async () => {
    const TENANT = 'tenant-norule';
    stub(NotificationRule, 'findOne', () => mockQuery(null));
    let createCalled = false;
    stub(Notification, 'create', async () => { createCalled = true; });
    let ioCalled = false;
    stub(socketBridge, 'getIO', () => { ioCalled = true; return {}; });

    const result = await notificationService.emit(TENANT, 'unknown.event', {});

    assert.equal(result.dispatched, 0);
    assert.equal(createCalled, false);
    assert.equal(ioCalled, false);
  });

  it('disabled rule: silent no-op', async () => {
    const TENANT = 'tenant-disabled';
    stub(NotificationRule, 'findOne', () =>
      mockQuery({ tenantId: TENANT, event: 'system.test', enabled: false, recipients: { roles: ['admin'], userIds: [] }, channels: ['inapp'] })
    );
    let createCalled = false;
    stub(Notification, 'create', async () => { createCalled = true; });

    const result = await notificationService.emit(TENANT, 'system.test', {});

    assert.equal(result.dispatched, 0);
    assert.equal(createCalled, false);
  });

  it('muted preference filters the inapp channel for that recipient only', async () => {
    const TENANT = 'tenant-muted';
    stub(NotificationRule, 'findOne', () =>
      mockQuery({ tenantId: TENANT, event: 'system.test', enabled: true, recipients: { roles: ['admin'], userIds: [] }, channels: ['inapp'] })
    );
    stub(User, 'find', () => mockQuery([{ _id: ADMIN_1 }, { _id: ADMIN_2 }]));
    stub(NotificationPreference, 'find', () => mockQuery([{ userId: ADMIN_1, mutedChannels: ['inapp'] }]));

    const created = [];
    stub(Notification, 'create', async (doc) => {
      const saved = { ...doc, toObject: () => doc };
      created.push(saved);
      return saved;
    });
    stub(socketBridge, 'getIO', () => ({ to: () => ({ emit: () => {} }) }));

    const result = await notificationService.emit(TENANT, 'system.test', {});

    assert.equal(result.dispatched, 1);
    assert.equal(created.length, 1);
    assert.equal(String(created[0].userId), ADMIN_2);
  });

  it('extraRecipientUserIds is unioned with the rule-resolved recipient set', async () => {
    const TENANT = 'tenant-extra';
    stub(NotificationRule, 'findOne', () =>
      mockQuery({ tenantId: TENANT, event: 'system.test', enabled: true, recipients: { roles: [], userIds: [] }, channels: ['inapp'] })
    );
    // The bus validates every explicit userId (from the rule or from
    // options.extraRecipientUserIds) against User.find scoped to this tenant
    // before persisting/emitting — defense-in-depth against cross-tenant
    // recipient injection. Return EXTRA_USER as valid for this tenant.
    stub(User, 'find', () => mockQuery([{ _id: EXTRA_USER }]));
    stub(NotificationPreference, 'find', () => mockQuery([]));

    const created = [];
    stub(Notification, 'create', async (doc) => {
      const saved = { ...doc, toObject: () => doc };
      created.push(saved);
      return saved;
    });
    stub(socketBridge, 'getIO', () => ({ to: () => ({ emit: () => {} }) }));

    const result = await notificationService.emit(TENANT, 'system.test', {}, { extraRecipientUserIds: [EXTRA_USER] });

    assert.equal(result.dispatched, 1);
    assert.deepEqual(result.recipients, [EXTRA_USER]);
  });

  it('foreign-tenant extraRecipientUserIds are silently excluded (defense-in-depth)', async () => {
    // Regression guard for the adversarial Blocker: even if a caller passes
    // an extra userId that does NOT belong to this tenant, the bus MUST
    // filter it out via User.find({_id, tenantId, isDeleted:false}) before
    // persisting or emitting — otherwise the user:{userId} socket room
    // leaks a Notification into another tenant.
    const TENANT = 'tenant-foreign';
    const FOREIGN_USER = '507f1f77bcf86cd799439099';
    stub(NotificationRule, 'findOne', () =>
      mockQuery({
        tenantId: TENANT,
        event: 'system.test',
        enabled: true,
        recipients: { roles: [], userIds: [] },
        channels: ['inapp'],
      })
    );
    // User.find returns EMPTY for the foreign candidate — as it would in
    // production when the userId doesn't belong to the tenant.
    stub(User, 'find', () => mockQuery([]));
    stub(NotificationPreference, 'find', () => mockQuery([]));

    const created = [];
    stub(Notification, 'create', async (doc) => {
      const saved = { ...doc, toObject: () => doc };
      created.push(saved);
      return saved;
    });
    let socketEmitted = 0;
    stub(socketBridge, 'getIO', () => ({
      to: () => ({ emit: () => { socketEmitted += 1; } }),
    }));

    const result = await notificationService.emit(TENANT, 'system.test', {}, {
      extraRecipientUserIds: [FOREIGN_USER],
    });

    assert.equal(result.dispatched, 0, 'no Notification should be persisted');
    assert.equal(created.length, 0);
    assert.equal(socketEmitted, 0, 'no socket emit should reach the foreign user room');
    assert.deepEqual(result.recipients, []);
  });

  it('a single-recipient persistence failure is logged and does not abort the fanout for the rest', async () => {
    const TENANT = 'tenant-partial-fail';
    stub(NotificationRule, 'findOne', () =>
      mockQuery({ tenantId: TENANT, event: 'system.test', enabled: true, recipients: { roles: ['admin'], userIds: [] }, channels: ['inapp'] })
    );
    stub(User, 'find', () => mockQuery([{ _id: ADMIN_1 }, { _id: ADMIN_2 }]));
    stub(NotificationPreference, 'find', () => mockQuery([]));

    const created = [];
    stub(Notification, 'create', async (doc) => {
      if (String(doc.userId) === ADMIN_1) {
        throw new Error('transient DB error');
      }
      const saved = { ...doc, toObject: () => doc };
      created.push(saved);
      return saved;
    });
    stub(socketBridge, 'getIO', () => ({ to: () => ({ emit: () => {} }) }));

    const result = await notificationService.emit(TENANT, 'system.test', {});

    assert.equal(result.dispatched, 1);
    assert.equal(created.length, 1);
    assert.equal(String(created[0].userId), ADMIN_2);
  });
});
