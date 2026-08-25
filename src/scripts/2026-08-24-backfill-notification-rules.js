'use strict';

/**
 * One-shot: seeds the canonical NotificationRule catalog for every tenant
 * that doesn't already have it (2026-08-24).
 *
 * Context: notification.service.js#emit is a silent no-op when no rule
 * matches `{ tenantId, event }`. Rules were created ad-hoc via the UI in
 * dev but never seeded in prod tenants, so every emit call was dropping
 * silently → no bell, no toast, no persisted Notification.
 *
 * Idempotent: `updateOne({ tenantId, event }, { $setOnInsert: {...} }, { upsert: true })`
 * — safe to re-run; existing rules are left intact.
 *
 * Which tenants: every non-deleted tenant except the platform tenant
 * `__platform__` (superadmin only, not a business tenant).
 *
 * Which rules (matches the local seed the user confirmed):
 *   - sheet.signed              → roles: [admin]
 *   - ot.responsible.assigned   → roles: [admin, technician]
 *   - ot.note.added             → roles: [] (opt-in per user via preferences)
 *
 * All enabled by default with channel `inapp` only (email/push are phase 2
 * per design.md Non-Goals).
 *
 * Run: `node src/scripts/2026-08-24-backfill-notification-rules.js`
 * npm : `npm run db:backfill-notification-rules`
 */

import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Tenant } from '../models/tenant.model.js';
import { NotificationRule } from '../models/notificationRule.model.js';

const CANONICAL_RULES = [
  { event: 'sheet.signed',            roles: ['admin'] },
  { event: 'ot.responsible.assigned', roles: ['admin', 'technician'] },
  { event: 'ot.note.added',           roles: [] },
];

async function main() {
  const uri = env.MONGO_URI || env.DATABASE_URL;
  if (!uri) {
    throw new Error('MONGO_URI/DATABASE_URL not set');
  }
  await mongoose.connect(uri);
  console.log('[backfill-notification-rules] Connected. Seeding canonical rules per tenant...');

  const tenants = await Tenant.find({ isDeleted: { $ne: true }, tenantId: { $ne: '__platform__' } })
    .select('tenantId')
    .lean();

  console.log(`[backfill-notification-rules] Business tenants: ${tenants.length}`);

  let inserted = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    for (const rule of CANONICAL_RULES) {
      const result = await NotificationRule.updateOne(
        { tenantId: tenant.tenantId, event: rule.event },
        {
          $setOnInsert: {
            tenantId: tenant.tenantId,
            event: rule.event,
            recipients: { roles: rule.roles, userIds: [] },
            channels: ['inapp'],
            enabled: true,
            isDeleted: false,
            deletedAt: null,
          },
        },
        { upsert: true },
      );

      if (result.upsertedCount > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    }
  }

  console.log(`[backfill-notification-rules] Inserted (new): ${inserted}`);
  console.log(`[backfill-notification-rules] Skipped (already existed): ${skipped}`);
  console.log(`[backfill-notification-rules] Expected total (tenants × rules): ${tenants.length * CANONICAL_RULES.length}`);

  await mongoose.disconnect();
  console.log('[backfill-notification-rules] Done.');
}

main().catch((err) => {
  console.error('[backfill-notification-rules] Fatal:', err);
  process.exitCode = 1;
});
