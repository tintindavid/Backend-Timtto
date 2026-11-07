/**
 * seed-notification-rules-requisiciones-e4.js
 *
 * Idempotent seed — requisiciones-e4-oc-recepcion (task 1.9).
 *
 * For every non-deleted tenant, creates a default `NotificationRule` for each NEW E4 event (purchase order and
 * deliverables; channels: inapp + email, enabled). Recipients are dynamic (issuer, approvers, buyers, requester...) and
 * are passed by the service through `extraRecipientUserIds`, so the static roles/userIds lists stay EMPTY. Existing
 * rules are never overwritten.
 *
 * Usage:
 *   node scripts/seed-notification-rules-requisiciones-e4.js [--dry-run]
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { parseFlagsOrExit } from './lib/parse-flags.js';
import { Tenant } from '../src/models/tenant.model.js';
import { NotificationRule } from '../src/models/notificationRule.model.js';

export const REQUISICION_E4_EVENTS = [
  'requisicion.po.issued',
  'requisicion.po.approval.requested',
  'requisicion.po.approved',
  'requisicion.po.rejected',
  'requisicion.po.sent',
  'requisicion.deliverables.received',
  'requisicion.deliverables.returned',
  'requisicion.deliverables.accepted',
  'requisicion.reminder.deliverables',
  'requisicion.reminder.confirmation',
];

const TAG = '[seed-notification-rules-requisiciones-e4]';

export async function seedNotificationRulesRequisicionesE4({ dryRun = false } = {}) {
  const tenants = await Tenant.find({ isDeleted: false }).select('tenantId name').lean();
  console.log(`${TAG} Found ${tenants.length} active tenant(s)${dryRun ? ' (dry-run)' : ''}`);

  let seeded = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    for (const event of REQUISICION_E4_EVENTS) {
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
  const dryRun = parseFlagsOrExit({ boolean: ['dry-run'] }, 'node scripts/seed-notification-rules-requisiciones-e4.js [--dry-run]')['dry-run'] === true;
  await mongoose.connect(env.MONGO_URI);
  console.log(`${TAG} Connected to MongoDB`);
  await seedNotificationRulesRequisicionesE4({ dryRun });
  await mongoose.disconnect();
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error(`${TAG} Fatal error:`, err);
    process.exit(1);
  });
}
