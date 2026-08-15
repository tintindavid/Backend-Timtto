/**
 * seed-notification-rule-sheet-signed.js
 *
 * Idempotent seed — notify-on-sheet-signed (design.md D5).
 *
 * For every non-deleted tenant, creates a default `NotificationRule` for the
 * `sheet.signed` event ({ recipients: { roles: ['admin'] }, channels:
 * ['inapp'], enabled: true }) so the feature "just works" post-deploy
 * without manual admin configuration. Skips tenants that already have a
 * rule for `(tenantId, 'sheet.signed')` — running this script multiple
 * times never overwrites a tenant-modified rule.
 *
 * Uses env.MONGO_URI (same var as the app — src/config/env.js).
 *
 * The core loop is exported as `seedNotificationRuleSheetSigned()` (no
 * connect/disconnect) so it's unit-testable with mocked model statics —
 * see tests/scripts/seed-notification-rule-sheet-signed.test.js. The
 * connect/disconnect/exit-code CLI wrapper only runs when this file is
 * invoked directly (`node scripts/...`), not when imported.
 *
 * Usage:
 *   node scripts/seed-notification-rule-sheet-signed.js
 *   npm run seed:notification-sheet-signed --prefix TimttoApp
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { NotificationRule } from '../src/models/notificationRule.model.js';

export const SHEET_SIGNED_EVENT = 'sheet.signed';

export async function seedNotificationRuleSheetSigned() {
  const tenants = await Tenant.find({ isDeleted: false }).select('tenantId name').lean();
  console.log(`[seed-notification-rule-sheet-signed] Found ${tenants.length} active tenant(s)`);

  let seeded = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    // design.md D5's pseudocode logs `tenant.slug`, but Tenant has no `slug`
    // field (src/models/tenant.model.js) — use `name` (falls back to the
    // tenantId slug string) for a readable log line instead.
    const label = tenant.name || tenant.tenantId;
    const exists = await NotificationRule.exists({ tenantId: tenant.tenantId, event: SHEET_SIGNED_EVENT });
    if (exists) {
      console.log(`[seed-notification-rule-sheet-signed] skip — ${label} already has a '${SHEET_SIGNED_EVENT}' rule`);
      skipped += 1;
      continue;
    }

    await NotificationRule.create({
      tenantId: tenant.tenantId,
      event: SHEET_SIGNED_EVENT,
      recipients: { roles: ['admin'], userIds: [] },
      channels: ['inapp'],
      enabled: true,
    });
    console.log(`[seed-notification-rule-sheet-signed] seeded — ${label}`);
    seeded += 1;
  }

  const result = { seeded, skipped, total: tenants.length };
  console.log(
    `[seed-notification-rule-sheet-signed] Done. seeded=${result.seeded} skipped=${result.skipped} total=${result.total}`
  );
  return result;
}

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('[seed-notification-rule-sheet-signed] Connected to MongoDB');
  await seedNotificationRuleSheetSigned();
  await mongoose.disconnect();
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[seed-notification-rule-sheet-signed] Fatal error:', err);
    process.exit(1);
  });
}
