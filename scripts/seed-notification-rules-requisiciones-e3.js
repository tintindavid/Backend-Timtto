/**
 * seed-notification-rules-requisiciones-e3.js
 *
 * Idempotent seed — requisiciones-e3-compras-portal (task 5.2).
 *
 * For every non-deleted tenant, creates a default `NotificationRule` for each NEW E3 event
 * (requisicion.rfq.sent / quote.received / winner.selected; channels: inapp + email, enabled). Recipients are dynamic
 * (creator, requester and buyers with `requisiciones:manage-suppliers`) and are passed by the service through
 * `extraRecipientUserIds`, so the static roles/userIds lists stay EMPTY. Existing rules are never overwritten.
 *
 * Usage:
 *   node scripts/seed-notification-rules-requisiciones-e3.js [--dry-run]
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { NotificationRule } from '../src/models/notificationRule.model.js';

export const REQUISICION_E3_EVENTS = [
  'requisicion.rfq.sent',
  'requisicion.quote.received',
  'requisicion.winner.selected',
];

const TAG = '[seed-notification-rules-requisiciones-e3]';

export async function seedNotificationRulesRequisicionesE3({ dryRun = false } = {}) {
  const tenants = await Tenant.find({ isDeleted: false }).select('tenantId name').lean();
  console.log(`${TAG} Found ${tenants.length} active tenant(s)${dryRun ? ' (dry-run)' : ''}`);

  let seeded = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    for (const event of REQUISICION_E3_EVENTS) {
      const exists = await NotificationRule.exists({ tenantId: tenant.tenantId, event });
      if (exists) {
        skipped += 1;
        continue;
      }
      if (!dryRun) {
        await NotificationRule.create({
          tenantId: tenant.tenantId,
          event,
          recipients: { roles: [], userIds: [] },
          channels: ['inapp', 'email'],
          enabled: true,
        });
      }
      console.log(`${TAG} ${dryRun ? 'would seed' : 'seeded'} — ${tenant.name || tenant.tenantId} / ${event}`);
      seeded += 1;
    }
  }

  const result = { seeded, skipped, total: tenants.length, dryRun };
  console.log(`${TAG} Done. seeded=${seeded} skipped=${skipped} tenants=${tenants.length}`);
  return result;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGO_URI);
  console.log(`${TAG} Connected to MongoDB`);
  await seedNotificationRulesRequisicionesE3({ dryRun });
  await mongoose.disconnect();
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error(`${TAG} Fatal error:`, err);
    process.exit(1);
  });
}
