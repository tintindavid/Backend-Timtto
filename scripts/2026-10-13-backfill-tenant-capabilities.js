/**
 * 2026-10-13-backfill-tenant-capabilities.js
 *
 * One-shot, idempotent backfill (tenant-capabilities-hybrid-mode): writes the explicit provider
 * defaults `capabilities: { executesServices: true, registersExternal: false }` on every Tenant that
 * lacks the field. Soft-deleted tenants are included on purpose. `organizationCustomerId` is never
 * touched.
 *
 * Until it runs, the code tolerates a missing field (normalizeCapabilities treats it as the
 * defaults), so running it is safe at any time and in any order relative to the deploy.
 *
 * Usage:
 *   node scripts/2026-10-13-backfill-tenant-capabilities.js --dry-run
 *   node scripts/2026-10-13-backfill-tenant-capabilities.js
 *
 * Uses env.MONGO_URI (same var as the app). The core is exported as `backfillTenantCapabilities()`
 * (no connect/disconnect) so it is unit-testable; the CLI wrapper only runs when the file is invoked
 * directly. It prints the number of tenants it matches and changes.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { DEFAULT_CAPABILITIES } from '../src/config/tenantCapabilities.config.js';

const FILTER = { capabilities: { $exists: false } };

export async function backfillTenantCapabilities({ dryRun = false } = {}) {
  const matched = await Tenant.countDocuments(FILTER).setOptions({ includeDeleted: true });
  console.log(`[backfill-tenant-capabilities] ${matched} tenant(s) without capabilities${dryRun ? ' (dry run)' : ''}`);

  if (dryRun || matched === 0) {
    return { matched, updated: 0, dryRun };
  }

  const res = await Tenant.updateMany(FILTER, { $set: { capabilities: { ...DEFAULT_CAPABILITIES } } })
    .setOptions({ includeDeleted: true });
  const updated = res.modifiedCount ?? 0;
  console.log(`[backfill-tenant-capabilities] updated ${updated} tenant(s)`);
  return { matched, updated, dryRun };
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-tenant-capabilities] Connected to MongoDB');
  try {
    await backfillTenantCapabilities({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-tenant-capabilities] Fatal error:', err);
    process.exit(1);
  });
}
