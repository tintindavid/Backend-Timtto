import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Tenant } from '../../src/models/tenant.model.js';
import { NotificationRule } from '../../src/models/notificationRule.model.js';
import {
  seedNotificationRulesRequisiciones,
  REQUISICION_EVENTS,
} from '../../scripts/seed-notification-rules-requisiciones.js';

function mockQuery(result) {
  return { select: () => ({ lean: () => Promise.resolve(result) }), lean: () => Promise.resolve(result) };
}

describe('seedNotificationRulesRequisiciones', () => {
  afterEach(() => {
    delete Tenant.find;
    delete NotificationRule.exists;
    delete NotificationRule.create;
  });

  it('creates one rule per event per tenant (inapp+email)', async () => {
    Tenant.find = () => mockQuery([{ tenantId: 'a', name: 'A' }, { tenantId: 'b', name: 'B' }]);
    NotificationRule.exists = async () => false;
    const created = [];
    NotificationRule.create = async (d) => { created.push(d); return d; };

    const r = await seedNotificationRulesRequisiciones();

    assert.equal(r.seeded, 2 * REQUISICION_EVENTS.length);
    assert.equal(created.length, 14);
    assert.ok(created.every((d) => d.channels.includes('email') && d.channels.includes('inapp') && d.enabled));
  });

  it('is idempotent: existing rules are skipped, never overwritten', async () => {
    Tenant.find = () => mockQuery([{ tenantId: 'a', name: 'A' }]);
    NotificationRule.exists = async ({ event }) => event !== 'requisicion.cancelled';
    const created = [];
    NotificationRule.create = async (d) => { created.push(d); return d; };

    const r = await seedNotificationRulesRequisiciones();

    assert.equal(r.seeded, 1);
    assert.equal(r.skipped, REQUISICION_EVENTS.length - 1);
    assert.equal(created[0].event, 'requisicion.cancelled');
  });

  it('--dry-run writes nothing', async () => {
    Tenant.find = () => mockQuery([{ tenantId: 'a', name: 'A' }]);
    NotificationRule.exists = async () => false;
    let called = false;
    NotificationRule.create = async () => { called = true; };

    const r = await seedNotificationRulesRequisiciones({ dryRun: true });

    assert.equal(called, false);
    assert.equal(r.seeded, REQUISICION_EVENTS.length);
  });
});
