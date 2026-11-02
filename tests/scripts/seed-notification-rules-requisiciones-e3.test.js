import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Tenant } from '../../src/models/tenant.model.js';
import { NotificationRule } from '../../src/models/notificationRule.model.js';
import { NOTIFICATION_EVENTS } from '../../src/config/notificationEvents.js';
import {
  seedNotificationRulesRequisicionesE3,
  REQUISICION_E3_EVENTS,
} from '../../scripts/seed-notification-rules-requisiciones-e3.js';

const mockQuery = (result) => ({ select: () => ({ lean: () => Promise.resolve(result) }), lean: () => Promise.resolve(result) });

describe('seedNotificationRulesRequisicionesE3', () => {
  afterEach(() => {
    delete Tenant.find;
    delete NotificationRule.exists;
    delete NotificationRule.create;
  });

  it('the three events are registered in the notification catalogue', () => {
    assert.deepEqual([...REQUISICION_E3_EVENTS], ['requisicion.rfq.sent', 'requisicion.quote.received', 'requisicion.winner.selected']);
    for (const e of REQUISICION_E3_EVENTS) assert.ok(NOTIFICATION_EVENTS.includes(e), e);
  });

  it('creates one rule per event per tenant (inapp+email)', async () => {
    Tenant.find = () => mockQuery([{ tenantId: 'a', name: 'A' }, { tenantId: 'b', name: 'B' }]);
    NotificationRule.exists = async () => false;
    const created = [];
    NotificationRule.create = async (d) => { created.push(d); return d; };
    const r = await seedNotificationRulesRequisicionesE3();
    assert.equal(r.seeded, 6);
    assert.ok(created.every((d) => d.channels.includes('email') && d.channels.includes('inapp') && d.enabled));
  });

  it('is idempotent and --dry-run writes nothing', async () => {
    Tenant.find = () => mockQuery([{ tenantId: 'a', name: 'A' }]);
    NotificationRule.exists = async ({ event }) => event !== 'requisicion.winner.selected';
    const created = [];
    NotificationRule.create = async (d) => { created.push(d); return d; };
    const r = await seedNotificationRulesRequisicionesE3();
    assert.equal(r.seeded, 1);
    assert.equal(r.skipped, 2);
    assert.equal(created[0].event, 'requisicion.winner.selected');
    created.length = 0;
    NotificationRule.exists = async () => false;
    const d = await seedNotificationRulesRequisicionesE3({ dryRun: true });
    assert.equal(created.length, 0);
    assert.equal(d.seeded, 3);
  });
});
