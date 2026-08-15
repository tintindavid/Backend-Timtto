/**
 * tests/services/notificationRule.service.test.js
 *
 * Unit tests for notificationRuleService.create / update — specifically the
 * cross-tenant recipient-injection guard added after the adversarial
 * Blocker (assertUserIdsBelongToTenant). Regression guard: a future
 * refactor that removes the User.find check MUST break these tests.
 *
 * Same monkey-patching convention as notification.service.test.js.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { notificationRuleService } from '../../src/services/notificationRule.service.js';
import { NotificationRule } from '../../src/models/notificationRule.model.js';
import { User } from '../../src/models/user.model.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const TENANT = 'tenant-rule-guard';
const LOCAL_USER = '507f1f77bcf86cd799439021';
const FOREIGN_USER = '507f1f77bcf86cd799439099';

const stubs = [];
function stub(target, key, value) {
  stubs.push([target, key, target[key]]);
  target[key] = value;
}
function mockQuery(result) {
  return { lean: () => Promise.resolve(result), then: (r, e) => Promise.resolve(result).then(r, e) };
}

describe('notificationRuleService.create — tenant-guard on recipients.userIds', () => {
  afterEach(() => {
    while (stubs.length) {
      const [target, key, original] = stubs.pop();
      target[key] = original;
    }
  });

  it('rejects a foreign-tenant userId with 400 INVALID_RECIPIENT_USER_IDS', async () => {
    // User.find is what asserts membership. Simulate the foreign id not
    // being in this tenant (User.find returns []).
    stub(User, 'find', () => mockQuery([]));
    let createCalled = false;
    stub(NotificationRule, 'exists', async () => false);
    stub(NotificationRule, 'create', async () => { createCalled = true; return {}; });

    let thrown = null;
    try {
      await notificationRuleService.create(
        {
          event: 'system.test',
          recipients: { roles: [], userIds: [FOREIGN_USER] },
          channels: ['inapp'],
          enabled: true,
        },
        TENANT
      );
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown instanceof ApiError, 'must throw ApiError');
    assert.equal(thrown.statusCode, 400);
    assert.equal(thrown.code, 'INVALID_RECIPIENT_USER_IDS');
    assert.deepEqual(thrown.details.foreignUserIds, [FOREIGN_USER]);
    assert.equal(createCalled, false, 'NotificationRule.create must NOT be reached');
  });

  it('accepts a userId that does belong to the tenant', async () => {
    stub(User, 'find', () => mockQuery([{ _id: LOCAL_USER }]));
    stub(NotificationRule, 'exists', async () => false);
    let created = null;
    stub(NotificationRule, 'create', async (doc) => {
      created = doc;
      return { toJSON: () => ({ _id: 'rule-1', ...doc }) };
    });

    const result = await notificationRuleService.create(
      {
        event: 'system.test',
        recipients: { roles: [], userIds: [LOCAL_USER] },
        channels: ['inapp'],
        enabled: true,
      },
      TENANT
    );

    assert.equal(result._id, 'rule-1');
    assert.deepEqual(created.recipients.userIds, [LOCAL_USER]);
    assert.equal(created.tenantId, TENANT);
  });

  it('is a no-op check when recipients.userIds is empty', async () => {
    // User.find must NOT be called when there are no userIds to check.
    let userFindCalled = false;
    stub(User, 'find', () => {
      userFindCalled = true;
      return mockQuery([]);
    });
    stub(NotificationRule, 'exists', async () => false);
    stub(NotificationRule, 'create', async (doc) => ({ toJSON: () => ({ _id: 'rule-2', ...doc }) }));

    await notificationRuleService.create(
      {
        event: 'system.test',
        recipients: { roles: ['admin'], userIds: [] },
        channels: ['inapp'],
        enabled: true,
      },
      TENANT
    );

    assert.equal(userFindCalled, false, 'User.find should not run when userIds is empty');
  });
});
