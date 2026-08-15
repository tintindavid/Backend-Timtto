/**
 * tests/scripts/seed-notification-rule-sheet-signed.test.js
 *
 * Unit tests for `seedNotificationRuleSheetSigned()`
 * (openspec/changes/notify-on-sheet-signed, tasks.md 3.3 / design.md D5).
 * DB-free — Tenant.find / NotificationRule.exists / NotificationRule.create
 * are monkey-patched (same convention as tests/services/notification.service.test.js).
 * The script's `Tenant.find({ isDeleted: false })` call relies on
 * Tenant's own pre-find hook to exclude soft-deleted tenants, so the mock
 * only needs to return the already-filtered set — scenario 3 asserts that
 * behavior by simply omitting the soft-deleted tenant from the mock result.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Tenant } from '../../src/models/tenant.model.js';
import { NotificationRule } from '../../src/models/notificationRule.model.js';
import {
  seedNotificationRuleSheetSigned,
  SHEET_SIGNED_EVENT,
} from '../../scripts/seed-notification-rule-sheet-signed.js';

function mockQuery(result) {
  return { select: () => ({ lean: () => Promise.resolve(result) }), lean: () => Promise.resolve(result) };
}

describe('seedNotificationRuleSheetSigned', () => {
  afterEach(() => {
    delete Tenant.find;
    delete NotificationRule.exists;
    delete NotificationRule.create;
  });

  it('creates the default rule for every tenant that does not already have one', async () => {
    Tenant.find = () => mockQuery([
      { tenantId: 'tenant-a', name: 'Tenant A' },
      { tenantId: 'tenant-b', name: 'Tenant B' },
    ]);
    NotificationRule.exists = async () => false;
    const created = [];
    NotificationRule.create = async (doc) => { created.push(doc); return doc; };

    const result = await seedNotificationRuleSheetSigned();

    assert.equal(result.seeded, 2);
    assert.equal(result.skipped, 0);
    assert.equal(result.total, 2);
    assert.equal(created.length, 2);
    for (const doc of created) {
      assert.equal(doc.event, SHEET_SIGNED_EVENT);
      assert.deepEqual(doc.recipients, { roles: ['admin'], userIds: [] });
      assert.deepEqual(doc.channels, ['inapp']);
      assert.equal(doc.enabled, true);
    }
    assert.deepEqual(created.map((d) => d.tenantId).sort(), ['tenant-a', 'tenant-b']);
  });

  it('rerun is idempotent — skips tenants that already have a rule and never overwrites it', async () => {
    Tenant.find = () => mockQuery([
      { tenantId: 'tenant-a', name: 'Tenant A' }, // already has a (possibly admin-modified) rule
      { tenantId: 'tenant-b', name: 'Tenant B' }, // still needs one
    ]);
    NotificationRule.exists = async ({ tenantId }) => tenantId === 'tenant-a';
    const created = [];
    NotificationRule.create = async (doc) => { created.push(doc); return doc; };

    const result = await seedNotificationRuleSheetSigned();

    assert.equal(result.seeded, 1);
    assert.equal(result.skipped, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0].tenantId, 'tenant-b');
  });

  it('excludes soft-deleted tenants — Tenant.find({ isDeleted: false }) never returns them', async () => {
    let capturedFilter = null;
    Tenant.find = (filter) => {
      capturedFilter = filter;
      // A real Tenant.find would already exclude isDeleted:true tenants via
      // the model's own pre(/^find/) hook + this explicit filter; the mock
      // mirrors that by simply never including the deleted tenant here.
      return mockQuery([{ tenantId: 'tenant-active', name: 'Active Tenant' }]);
    };
    NotificationRule.exists = async () => false;
    const created = [];
    NotificationRule.create = async (doc) => { created.push(doc); return doc; };

    const result = await seedNotificationRuleSheetSigned();

    assert.deepEqual(capturedFilter, { isDeleted: false });
    assert.equal(result.total, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0].tenantId, 'tenant-active');
  });
});
