/**
 * 2026-10-26-backfill-manages-customers.js
 *
 * One-shot, idempotent migration (change: requisiciones-e1-base-aprobacion, capability managesCustomers):
 * every tenant that executes services and has no stored `capabilities.managesCustomers` gets it set to `true`
 * (they already created customers under "Ejecuta servicios"; the product decision is that they keep doing so).
 * A tenant with no `capabilities` at all is a provider by default (executesServices defaults to true), so it is
 * included. Tenants that do not execute services, and tenants that already store the flag (true or false), are
 * never touched. The code already reads a missing value as executesServices (normalizeCapabilities), so the
 * deploy is safe in any order relative to this script; it just makes the value explicit.
 *
 * A second run matches nothing and changes nothing. Soft-deleted tenants are included on purpose.
 *
 * Usage:
 *   node scripts/2026-10-26-backfill-manages-customers.js --dry-run
 *   node scripts/2026-10-26-backfill-manages-customers.js
 *
 * Core exported as `backfillManagesCustomers()` (no connect/disconnect) so it is unit-testable.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';

export const MANAGES_CUSTOMERS_FILTER = Object.freeze({
  'capabilities.managesCustomers': { $exists: false },
  'capabilities.executesServices': { $ne: false },
});

// A tenant stored with `capabilities: null` (hand-edited data) makes the dotted-path $set below fail with
// MongoServerError code 28 and abort the script. Native collection (no casting/hooks): `$type: 'null'` matches
// only an explicit null, not a missing field. Those tenants get `capabilities: {}` first so the main write works.
export const NULL_CAPABILITIES_FILTER = Object.freeze({ capabilities: { $type: 'null' } });

export async function backfillManagesCustomers({ dryRun = false } = {}) {
  const nullCapabilitiesTenants = await Tenant.collection.countDocuments({ ...NULL_CAPABILITIES_FILTER });
  const tenantsToUpdate = await Tenant.countDocuments({ ...MANAGES_CUSTOMERS_FILTER }).setOptions({ includeDeleted: true });
  console.log(`[backfill-manages-customers] tenants to set managesCustomers=true: ${tenantsToUpdate}${dryRun ? ' (dry run)' : ''}`);

  const result = { tenantsToUpdate, tenantsUpdated: 0, nullCapabilitiesTenants, dryRun };
  if (nullCapabilitiesTenants > 0) {
    console.log(`[backfill-manages-customers] tenants with capabilities=null (normalized to {}): ${nullCapabilitiesTenants}`);
  }
  if (dryRun) return result;
  if (nullCapabilitiesTenants > 0) {
    await Tenant.collection.updateMany({ ...NULL_CAPABILITIES_FILTER }, { $set: { capabilities: {} } });
  }
  if (tenantsToUpdate === 0) return result;

  // Only this one key (dot notation): the other capability flags are never rewritten.
  const r = await Tenant.updateMany({ ...MANAGES_CUSTOMERS_FILTER }, { $set: { 'capabilities.managesCustomers': true } })
    .setOptions({ includeDeleted: true });
  result.tenantsUpdated = r.modifiedCount ?? 0;
  console.log('[backfill-manages-customers] updated', result);
  return result;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-manages-customers] Connected to MongoDB');
  try {
    await backfillManagesCustomers({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-manages-customers] Fatal error:', err);
    process.exit(1);
  });
}
