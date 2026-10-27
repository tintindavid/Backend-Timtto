/**
 * seed-notification-rules-requisiciones.js
 *
 * Idempotent seed — requisiciones-e1-base-aprobacion.
 *
 * For every non-deleted tenant, creates a default `NotificationRule` for each
 * `requisicion.*` event (channels: inapp + email, enabled). Recipients are
 * dynamic (level approvers, area head, creator, requester) and are passed by
 * the transition service via `extraRecipientUserIds`, so the static
 * roles/userIds lists are left EMPTY. Existing rules are never overwritten.
 *
 * Usage:
 *   node scripts/seed-notification-rules-requisiciones.js [--dry-run]
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { NotificationRule } from '../src/models/notificationRule.model.js';

export const REQUISICION_EVENTS = [
  'requisicion.submitted',
  'requisicion.approval.requested',
  'requisicion.level.approved',
  'requisicion.approved',
  'requisicion.rejected',
  'requisicion.withdrawn',
  'requisicion.cancelled',
];

const TAG = '[seed-notification-rules-requisiciones]';

export async function seedNotificationRulesRequisiciones({ dryRun = false } = {}) {
  const tenants = await Tenant.find({ isDeleted: false }).select('tenantId name').lean();
  console.log(`${TAG} Found ${tenants.length} active tenant(s)${dryRun ? ' (dry-run)' : ''}`);

  let seeded = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    for (const event of REQUISICION_EVENTS) {
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
  await seedNotificationRulesRequisiciones({ dryRun });
  await mongoose.disconnect();
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error(`${TAG} Fatal error:`, err);
    process.exit(1);
  });
}
