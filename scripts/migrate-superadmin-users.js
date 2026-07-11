/**
 * migrate-superadmin-users.js
 *
 * One-off migration — E0 saas-security-baseline.
 *
 * Finds users whose tenantId was the old magic sentinel ('superadmin' | 'SUPERADMIN')
 * and promotes them to the new first-class SuperAdmin representation:
 *   role = 'superadmin'
 *   tenantId = '__platform__'
 *
 * Idempotent: running it twice produces the same result.
 *
 * Safety check: if a *real* Tenant document exists with tenantId 'superadmin' or
 * 'SUPERADMIN', the script refuses to run and exits with code 1 to avoid
 * data corruption. Operator must resolve this manually first.
 *
 * Usage:
 *   MONGO_URI=mongodb://... node scripts/migrate-superadmin-users.js
 */

import mongoose from 'mongoose';
import { User } from '../src/models/user.model.js';
import { Tenant } from '../src/models/tenant.model.js';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('[migrate-superadmin-users] MONGO_URI env var is required');
  process.exit(1);
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('[migrate-superadmin-users] Connected to MongoDB');

  // Safety check: ensure no real tenant carries the sentinel id.
  const sentinelTenants = await Tenant.find(
    { tenantId: { $in: ['superadmin', 'SUPERADMIN'] } },
    { tenantId: 1, name: 1 },
  ).setOptions({ includeDeleted: true }).lean();

  if (sentinelTenants.length > 0) {
    console.error(
      '[migrate-superadmin-users] ABORT — real Tenant document(s) found with sentinel tenantId:',
      sentinelTenants.map((t) => `${t.tenantId} (${t.name})`).join(', '),
    );
    console.error('[migrate-superadmin-users] Resolve these tenants manually before running the migration.');
    process.exit(1);
  }

  // Find users with legacy sentinel tenantId.
  const candidates = await User.find(
    { tenantId: { $in: ['superadmin', 'SUPERADMIN'] } },
    { _id: 1, email: 1, tenantId: 1, role: 1 },
  ).setOptions({ includeDeleted: true }).lean();

  if (candidates.length === 0) {
    console.log('[migrate-superadmin-users] No sentinel users found — nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log(`[migrate-superadmin-users] Found ${candidates.length} user(s) to migrate:`);

  let migrated = 0;
  for (const candidate of candidates) {
    const result = await User.updateOne(
      { _id: candidate._id },
      { $set: { role: 'superadmin', tenantId: '__platform__' } },
    );
    if (result.modifiedCount > 0) {
      console.log(`  Migrated: ${candidate.email} (${candidate._id}) — tenantId: ${candidate.tenantId} → __platform__, role: ${candidate.role} → superadmin`);
      migrated++;
    } else {
      console.log(`  Skipped (already migrated?): ${candidate.email} (${candidate._id})`);
    }
  }

  console.log(`[migrate-superadmin-users] Done. Migrated ${migrated} of ${candidates.length} user(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[migrate-superadmin-users] Fatal error:', err);
  process.exit(1);
});
