/**
 * seed-notification-rule-ot-responsible-assigned.js
 *
 * Idempotent seed — ot-responsables-programacion-trazable (design.md
 * Migration Plan step 2.b).
 *
 * For every non-deleted tenant, creates a default `NotificationRule` for
 * the `ot.responsible.assigned` event ({ recipients: { roles: ['admin',
 * 'technician'] }, channels: ['inapp'], enabled: true }) so newly-assigned
 * responsables get notified without manual admin configuration. Skips
 * tenants that already have a rule for `(tenantId, 'ot.responsible.assigned')`
 * — running this script multiple times never overwrites a tenant-modified
 * rule (e.g. an admin who narrowed recipients.roles to just `['admin']`,
 * design.md Risks).
 *
 * Uses env.MONGO_URI (same var as the app — src/config/env.js).
 *
 * The core loop is exported as `seedNotificationRuleOtResponsibleAssigned()`
 * (no connect/disconnect) so it's unit-testable with mocked model statics —
 * see tests/scripts/seed-notification-rule-ot-responsible-assigned.test.js.
 * The connect/disconnect/exit-code CLI wrapper only runs when this file is
 * invoked directly (`node scripts/...`), not when imported.
 *
 * Usage:
 *   node scripts/seed-notification-rule-ot-responsible-assigned.js
 *   npm run seed:notification-rule-ot-responsible-assigned --prefix TimttoApp
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { NotificationRule } from '../src/models/notificationRule.model.js';

export const OT_RESPONSIBLE_ASSIGNED_EVENT = 'ot.responsible.assigned';

export async function seedNotificationRuleOtResponsibleAssigned() {
  const tenants = await Tenant.find({ isDeleted: false }).select('tenantId name').lean();
  console.log(`[seed-notification-rule-ot-responsible-assigned] Found ${tenants.length} active tenant(s)`);

  let seeded = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    const label = tenant.name || tenant.tenantId;
    const exists = await NotificationRule.exists({
      tenantId: tenant.tenantId,
      event: OT_RESPONSIBLE_ASSIGNED_EVENT,
    });
    if (exists) {
      console.log(`[seed-notification-rule-ot-responsible-assigned] skip — ${label} already has a '${OT_RESPONSIBLE_ASSIGNED_EVENT}' rule`);
      skipped += 1;
      continue;
    }

    await NotificationRule.create({
      tenantId: tenant.tenantId,
      event: OT_RESPONSIBLE_ASSIGNED_EVENT,
      recipients: { roles: ['admin', 'technician'], userIds: [] },
      channels: ['inapp'],
      enabled: true,
    });
    console.log(`[seed-notification-rule-ot-responsible-assigned] seeded — ${label}`);
    seeded += 1;
  }

  const result = { seeded, skipped, total: tenants.length };
  console.log(
    `[seed-notification-rule-ot-responsible-assigned] Done. seeded=${result.seeded} skipped=${result.skipped} total=${result.total}`,
  );
  return result;
}

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('[seed-notification-rule-ot-responsible-assigned] Connected to MongoDB');
  await seedNotificationRuleOtResponsibleAssigned();
  await mongoose.disconnect();
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[seed-notification-rule-ot-responsible-assigned] Fatal error:', err);
    process.exit(1);
  });
}
