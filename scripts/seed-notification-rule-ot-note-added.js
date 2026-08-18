/**
 * seed-notification-rule-ot-note-added.js
 *
 * Idempotent seed — companion to ot-responsables-programacion-trazable.
 *
 * For every non-deleted tenant, creates a default `NotificationRule` for
 * the `ot.note.added` event with an EMPTY roles/userIds list so only the
 * OT's active responsables receive it (they are passed via
 * `extraRecipientUserIds` from ot.service.addNota). Admins that want to
 * be CC'd on every nota can edit the rule from /settings/notifications
 * and add themselves to `recipients.roles` or `recipients.userIds`.
 *
 * Skips tenants that already have a rule for (tenantId, 'ot.note.added')
 * — rerunning never overwrites a tenant-modified rule.
 *
 * Usage:
 *   node scripts/seed-notification-rule-ot-note-added.js
 *   npm run seed:notification-rule-ot-note-added --prefix TimttoApp
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { NotificationRule } from '../src/models/notificationRule.model.js';

export const OT_NOTE_ADDED_EVENT = 'ot.note.added';

export async function seedNotificationRuleOtNoteAdded() {
  const tenants = await Tenant.find({ isDeleted: false }).select('tenantId name').lean();
  console.log(`[seed-notification-rule-ot-note-added] Found ${tenants.length} active tenant(s)`);

  let seeded = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    const label = tenant.name || tenant.tenantId;
    const exists = await NotificationRule.exists({
      tenantId: tenant.tenantId,
      event: OT_NOTE_ADDED_EVENT,
    });
    if (exists) {
      console.log(`[seed-notification-rule-ot-note-added] skip — ${label} already has a rule`);
      skipped += 1;
      continue;
    }

    await NotificationRule.create({
      tenantId: tenant.tenantId,
      event: OT_NOTE_ADDED_EVENT,
      recipients: { roles: [], userIds: [] },
      channels: ['inapp'],
      enabled: true,
    });
    console.log(`[seed-notification-rule-ot-note-added] seeded — ${label}`);
    seeded += 1;
  }

  const result = { seeded, skipped, total: tenants.length };
  console.log(
    `[seed-notification-rule-ot-note-added] Done. seeded=${result.seeded} skipped=${result.skipped} total=${result.total}`
  );
  return result;
}

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('[seed-notification-rule-ot-note-added] Connected to MongoDB');
  await seedNotificationRuleOtNoteAdded();
  await mongoose.disconnect();
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[seed-notification-rule-ot-note-added] Fatal error:', err);
    process.exit(1);
  });
}
