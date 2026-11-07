/**
 * 2026-11-04-backfill-requisiciones-permisos-e4.js
 *
 * One-shot, idempotent migration (change: requisiciones-e4-oc-recepcion, task 1.3): grants the new permissions
 * `requisiciones:issue-po` (issue / edit / send the purchase order), `requisiciones:approve-po` (approve or reject it) and
 * `requisiciones:manage-deliverables` (review the supplier's deliverables) with `$addToSet` ONLY to:
 *   - roles named "admin" (case-insensitive), and
 *   - system roles (`isSystem: true`).
 * NEVER to a role marked `isDefault: true` (the role every new user receives). Only roles that lack at least one of
 * the three permissions are matched, so a second run changes nothing. Soft-deleted roles are ignored.
 *
 * SAFE USAGE (npm run backfill:requisiciones-permisos-e4 -- <flags>):
 *   1. ALWAYS run `--dry-run` first and review the number of roles that would change. WITHOUT `--dry-run` it WRITES.
 *   2. Idempotent: a second run matches and changes nothing.
 *   3. Applies to the roles of ALL tenants (there is no --tenant flag); the dry run prints how many would change.
 *
 *   node scripts/2026-11-04-backfill-requisiciones-permisos-e4.js --dry-run
 *   node scripts/2026-11-04-backfill-requisiciones-permisos-e4.js
 *
 * Core exported as `backfillRequisicionesPermisosE4()` (no connect/disconnect) and the real filter as `E4_ROLE_FILTER`,
 * so the tests exercise exactly what runs in production.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { parseFlagsOrExit } from './lib/parse-flags.js';
import { Role } from '../src/models/role.model.js';
import { PERMISSIONS } from '../src/constants/permissions.js';

export const E4_PERMISSIONS = Object.freeze([
  PERMISSIONS.REQUISICIONES_ISSUE_PO,
  PERMISSIONS.REQUISICIONES_APPROVE_PO,
  PERMISSIONS.REQUISICIONES_MANAGE_DELIVERABLES,
]);

/** Admin/system roles that lack at least one of the permissions. `isDefault` roles are excluded on purpose. */
export const E4_ROLE_FILTER = Object.freeze({
  isDeleted: { $ne: true },
  isDefault: { $ne: true },
  $and: [
    { $or: [{ name: { $regex: /^admin$/i } }, { isSystem: true }] },
    { $or: E4_PERMISSIONS.map((p) => ({ permissions: { $ne: p } })) },
  ],
});

export async function backfillRequisicionesPermisosE4({ dryRun = false } = {}) {
  const rolesToUpdate = await Role.countDocuments({ ...E4_ROLE_FILTER });
  console.log(`[backfill-requisiciones-permisos-e4] roles to receive ${E4_PERMISSIONS.join(', ')}: ${rolesToUpdate}${dryRun ? ' (dry run)' : ''}`);
  const result = { rolesToUpdate, rolesUpdated: 0, dryRun };
  if (dryRun || rolesToUpdate === 0) return result;
  const r = await Role.updateMany({ ...E4_ROLE_FILTER }, { $addToSet: { permissions: { $each: [...E4_PERMISSIONS] } } });
  result.rolesUpdated = r.modifiedCount ?? 0;
  console.log('[backfill-requisiciones-permisos-e4] updated', result);
  return result;
}

async function run() {
  const dryRun = parseFlagsOrExit({ boolean: ['dry-run'] }, 'node scripts/2026-11-04-backfill-requisiciones-permisos-e4.js [--dry-run]')['dry-run'] === true;
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-requisiciones-permisos-e4] Connected to MongoDB');
  try {
    await backfillRequisicionesPermisosE4({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-requisiciones-permisos-e4] Fatal error:', err);
    process.exit(1);
  });
}
