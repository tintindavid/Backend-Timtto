/**
 * 2026-10-27-backfill-requisiciones-receive.js
 *
 * One-shot, idempotent migration (change: requisiciones-e2-solicitudes-recepcion, task 1.5):
 * grants the new permission `requisiciones:receive` (register receptions, close lines short, cancel lines) with
 * `$addToSet` ONLY to:
 *   - roles named "admin" (case-insensitive), and
 *   - system roles (`isSystem: true`).
 * NEVER to a role marked `isDefault: true` (lesson of the E1 backfill, which handed approval permissions to the role
 * every new user receives). A role that is both admin/system AND default is skipped as well.
 *
 * Only roles that lack the permission are matched and written, so a second run changes nothing. Soft-deleted roles are
 * ignored. Existing permissions are untouched.
 *
 * SAFE USAGE (npm run backfill:requisiciones-receive -- <flags>):
 *   1. ALWAYS run `--dry-run` first and review the number of roles that would change. WITHOUT `--dry-run` the script WRITES.
 *   2. Idempotent: a second run matches and changes nothing.
 *   3. Tenant scoping: roles are tenant-owned documents and the script applies the same rule to the roles of ALL
 *      tenants (there is no --tenant flag); the dry run prints how many roles would change, so check that number first.
 *
 *   node scripts/2026-10-27-backfill-requisiciones-receive.js --dry-run
 *   node scripts/2026-10-27-backfill-requisiciones-receive.js
 *
 * Core exported as `backfillRequisicionesReceive()` (no connect/disconnect) so it is unit-testable; the real filter is
 * exported as `RECEIVE_ROLE_FILTER` so the test exercises exactly what runs in production.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Role } from '../src/models/role.model.js';
import { PERMISSIONS } from '../src/constants/permissions.js';

export const RECEIVE_PERMISSION = PERMISSIONS.REQUISICIONES_RECEIVE;

/** Roles that must receive the permission and still lack it. `isDefault` roles are excluded on purpose. */
export const RECEIVE_ROLE_FILTER = Object.freeze({
  isDeleted: { $ne: true },
  isDefault: { $ne: true },
  $or: [{ name: { $regex: /^admin$/i } }, { isSystem: true }],
  permissions: { $ne: RECEIVE_PERMISSION },
});

export async function backfillRequisicionesReceive({ dryRun = false } = {}) {
  const rolesToUpdate = await Role.countDocuments({ ...RECEIVE_ROLE_FILTER });
  console.log(`[backfill-requisiciones-receive] roles to receive ${RECEIVE_PERMISSION}: ${rolesToUpdate}${dryRun ? ' (dry run)' : ''}`);
  const result = { rolesToUpdate, rolesUpdated: 0, dryRun };
  if (dryRun || rolesToUpdate === 0) return result;
  const r = await Role.updateMany({ ...RECEIVE_ROLE_FILTER }, { $addToSet: { permissions: RECEIVE_PERMISSION } });
  result.rolesUpdated = r.modifiedCount ?? 0;
  console.log('[backfill-requisiciones-receive] updated', result);
  return result;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-requisiciones-receive] Connected to MongoDB');
  try {
    await backfillRequisicionesReceive({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-requisiciones-receive] Fatal error:', err);
    process.exit(1);
  });
}
