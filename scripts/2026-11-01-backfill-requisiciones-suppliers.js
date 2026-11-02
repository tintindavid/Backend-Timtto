/**
 * 2026-11-01-backfill-requisiciones-suppliers.js
 *
 * One-shot, idempotent migration (change: requisiciones-e3-compras-portal, task 1.3): grants the new permissions
 * `requisiciones:manage-suppliers` (assign suppliers, send/resend invitations, register quotations, close the
 * quotation window) and `requisiciones:select-winner` (choose the winner, direct purchase) with `$addToSet` ONLY to:
 *   - roles named "admin" (case-insensitive), and
 *   - system roles (`isSystem: true`).
 * NEVER to a role marked `isDefault: true` (the role every new user receives). Only roles that lack at least one of
 * the two permissions are matched, so a second run changes nothing. Soft-deleted roles are ignored.
 *
 * SAFE USAGE (npm run backfill:requisiciones-suppliers -- <flags>):
 *   1. ALWAYS run `--dry-run` first and review the number of roles that would change. WITHOUT `--dry-run` it WRITES.
 *   2. Idempotent: a second run matches and changes nothing.
 *   3. Applies to the roles of ALL tenants (there is no --tenant flag); the dry run prints how many would change.
 *
 *   node scripts/2026-11-01-backfill-requisiciones-suppliers.js --dry-run
 *   node scripts/2026-11-01-backfill-requisiciones-suppliers.js
 *
 * Core exported as `backfillRequisicionesSuppliers()` (no connect/disconnect) and the real filter as
 * `SUPPLIERS_ROLE_FILTER`, so the tests exercise exactly what runs in production.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Role } from '../src/models/role.model.js';
import { PERMISSIONS } from '../src/constants/permissions.js';

export const SUPPLIERS_PERMISSIONS = Object.freeze([
  PERMISSIONS.REQUISICIONES_MANAGE_SUPPLIERS,
  PERMISSIONS.REQUISICIONES_SELECT_WINNER,
]);

/** Admin/system roles that lack at least one of the permissions. `isDefault` roles are excluded on purpose. */
export const SUPPLIERS_ROLE_FILTER = Object.freeze({
  isDeleted: { $ne: true },
  isDefault: { $ne: true },
  $and: [
    { $or: [{ name: { $regex: /^admin$/i } }, { isSystem: true }] },
    { $or: SUPPLIERS_PERMISSIONS.map((p) => ({ permissions: { $ne: p } })) },
  ],
});

export async function backfillRequisicionesSuppliers({ dryRun = false } = {}) {
  const rolesToUpdate = await Role.countDocuments({ ...SUPPLIERS_ROLE_FILTER });
  console.log(`[backfill-requisiciones-suppliers] roles to receive ${SUPPLIERS_PERMISSIONS.join(', ')}: ${rolesToUpdate}${dryRun ? ' (dry run)' : ''}`);
  const result = { rolesToUpdate, rolesUpdated: 0, dryRun };
  if (dryRun || rolesToUpdate === 0) return result;
  const r = await Role.updateMany({ ...SUPPLIERS_ROLE_FILTER }, { $addToSet: { permissions: { $each: [...SUPPLIERS_PERMISSIONS] } } });
  result.rolesUpdated = r.modifiedCount ?? 0;
  console.log('[backfill-requisiciones-suppliers] updated', result);
  return result;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-requisiciones-suppliers] Connected to MongoDB');
  try {
    await backfillRequisicionesSuppliers({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-requisiciones-suppliers] Fatal error:', err);
    process.exit(1);
  });
}
