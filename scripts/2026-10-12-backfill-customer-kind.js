/**
 * 2026-10-12-backfill-customer-kind.js
 *
 * One-shot, idempotent backfill (terceros-customers-providers, design
 * decision 8): sets `kind: 'customer'` on every Customer document that lacks
 * the field. Soft-deleted documents are included on purpose.
 *
 * Until it runs, the code tolerates a missing `kind` (reads use
 * `kind: { $ne: 'provider' }`), so running it is safe at any time.
 *
 * Usage:
 *   node scripts/2026-10-12-backfill-customer-kind.js --dry-run
 *   node scripts/2026-10-12-backfill-customer-kind.js
 *
 * Uses env.MONGO_URI (same var as the app). The core is exported as
 * `backfillCustomerKind()` (no connect/disconnect) so it is unit-testable;
 * the CLI wrapper only runs when the file is invoked directly.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Customer } from '../src/models/customer.model.js';

const FILTER = { kind: { $exists: false } };

export async function backfillCustomerKind({ dryRun = false } = {}) {
  const matched = await Customer.countDocuments(FILTER);
  console.log(`[backfill-customer-kind] ${matched} document(s) without kind${dryRun ? ' (dry run)' : ''}`);

  if (dryRun || matched === 0) {
    return { matched, updated: 0, dryRun };
  }

  const res = await Customer.updateMany(FILTER, { $set: { kind: 'customer' } });
  const updated = res.modifiedCount ?? 0;
  console.log(`[backfill-customer-kind] updated ${updated} document(s)`);
  return { matched, updated, dryRun };
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-customer-kind] Connected to MongoDB');
  try {
    await backfillCustomerKind({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-customer-kind] Fatal error:', err);
    process.exit(1);
  });
}
