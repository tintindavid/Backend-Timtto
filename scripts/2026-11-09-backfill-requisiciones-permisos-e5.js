/**
 * 2026-11-09-backfill-requisiciones-permisos-e5.js
 *
 * One-shot, idempotent migration (change: requisiciones-e5-reporteria, task 1.1): grants the new permission
 * `requisiciones:reports` (tenant-wide dashboard, metrics and list Excel export) with `$addToSet` ONLY to:
 *   - roles that are BOTH named "admin" (case-insensitive) AND system roles (`isSystem: true`).
 * NEVER to a role marked `isDefault: true` (the role every new user receives). Only roles that lack the permission
 * are matched, so a second run changes nothing. Soft-deleted roles are ignored.
 *
 * SAFE USAGE (npm run backfill:requisiciones-permisos-e5 -- <flags>):
 *   1. ALWAYS run `--dry-run` first and review the number of roles that would change. WITHOUT `--dry-run` it WRITES.
 *   2. Idempotent: a second run matches and changes nothing.
 *   3. Applies to the roles of ALL tenants (there is no --tenant flag); the dry run prints how many would change.
 *
 *   node scripts/2026-11-09-backfill-requisiciones-permisos-e5.js --dry-run
 *   node scripts/2026-11-09-backfill-requisiciones-permisos-e5.js
 *
 * Core exported as `backfillRequisicionesPermisosE5()` (no connect/disconnect) and the real filter as `E5_ROLE_FILTER`,
 * so the tests exercise exactly what runs in production.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { parseFlagsOrExit } from './lib/parse-flags.js';
import { Role } from '../src/models/role.model.js';
import { PERMISSIONS } from '../src/constants/permissions.js';

export const E5_PERMISSIONS = Object.freeze([
  PERMISSIONS.REQUISICIONES_REPORTS,
]);

/** Admin/system roles that lack the permission. `isDefault` roles are excluded on purpose. */
export const E5_ROLE_FILTER = Object.freeze({
  isDeleted: { $ne: true },
  isDefault: { $ne: true },
  $and: [
    { name: { $regex: /^admin$/i } },
    { isSystem: true },
    { $or: E5_PERMISSIONS.map((p) => ({ permissions: { $ne: p } })) },
  ],
});

export async function backfillRequisicionesPermisosE5({ dryRun = false } = {}) {
  const rolesToUpdate = await Role.countDocuments({ ...E5_ROLE_FILTER });
  console.log(`[backfill-requisiciones-permisos-e5] roles to receive ${E5_PERMISSIONS.join(', ')}: ${rolesToUpdate}${dryRun ? ' (dry run)' : ''}`);
  const result = { rolesToUpdate, rolesUpdated: 0, dryRun };
  if (dryRun || rolesToUpdate === 0) return result;
  const r = await Role.updateMany({ ...E5_ROLE_FILTER }, { $addToSet: { permissions: { $each: [...E5_PERMISSIONS] } } });
  result.rolesUpdated = r.modifiedCount ?? 0;
  console.log('[backfill-requisiciones-permisos-e5] updated', result);
  return result;
}

async function run() {
  const dryRun = parseFlagsOrExit({ boolean: ['dry-run'] }, 'node scripts/2026-11-09-backfill-requisiciones-permisos-e5.js [--dry-run]')['dry-run'] === true;
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-requisiciones-permisos-e5] Connected to MongoDB');
  try {
    await backfillRequisicionesPermisosE5({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-requisiciones-permisos-e5] Fatal error:', err);
    process.exit(1);
  });
}
