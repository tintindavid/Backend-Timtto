/**
 * 2026-10-25-backfill-requisiciones.js
 *
 * One-shot, idempotent migration (change: requisiciones-e1-base-aprobacion):
 *   1. every admin-tier role (name "admin", case-insensitive, or isDefault: true) receives the new permissions
 *      `requisiciones:*`, `areas:*`, `approval-rules:*`, `budgets:*` and `request-types:*` with `$addToSet`
 *      (only roles that lack at least one of them are matched and written; existing permissions are untouched);
 *   2. every tenant without `capabilities.usesRequisiciones` gets it set to `false` explicitly (the code already reads
 *      a missing value as false, so this is cosmetic and safe in any order relative to the deploy). Other capability
 *      flags are never touched.
 *
 *   3. every requisition without `version` gets `version: 1` (missing already counted as 1; now explicit).
 *
 * A second run matches nothing and changes nothing. Soft-deleted tenants are included on purpose.
 *
 * Usage:
 *   node scripts/2026-10-25-backfill-requisiciones.js --dry-run
 *   node scripts/2026-10-25-backfill-requisiciones.js
 *
 * Core exported as `backfillRequisiciones()` (no connect/disconnect) so it is unit-testable.
 */

import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { env } from '../src/config/env.js';
import { Tenant } from '../src/models/tenant.model.js';
import { Role } from '../src/models/role.model.js';
import { Requisicion } from '../src/models/requisicion.model.js';
import { PERMISSIONS } from '../src/constants/permissions.js';

export const REQUISICIONES_PERMISSIONS = Object.freeze([
  PERMISSIONS.REQUISICIONES_READ,
  PERMISSIONS.REQUISICIONES_CREATE,
  PERMISSIONS.REQUISICIONES_UPDATE,
  PERMISSIONS.REQUISICIONES_DELETE,
  PERMISSIONS.REQUISICIONES_SEND,
  PERMISSIONS.REQUISICIONES_APPROVE,
  PERMISSIONS.REQUISICIONES_CANCEL,
  PERMISSIONS.REQUISICIONES_MANAGE_ALL,
  PERMISSIONS.AREAS_READ,
  PERMISSIONS.AREAS_CREATE,
  PERMISSIONS.AREAS_UPDATE,
  PERMISSIONS.AREAS_DELETE,
  PERMISSIONS.APPROVAL_RULES_READ,
  PERMISSIONS.APPROVAL_RULES_CREATE,
  PERMISSIONS.APPROVAL_RULES_UPDATE,
  PERMISSIONS.APPROVAL_RULES_DELETE,
  PERMISSIONS.BUDGETS_READ,
  PERMISSIONS.BUDGETS_CREATE,
  PERMISSIONS.BUDGETS_UPDATE,
  PERMISSIONS.BUDGETS_DELETE,
  PERMISSIONS.REQUEST_TYPES_READ,
  PERMISSIONS.REQUEST_TYPES_CREATE,
  PERMISSIONS.REQUEST_TYPES_UPDATE,
  PERMISSIONS.REQUEST_TYPES_DELETE,
]);

// Admin-tier roles that still miss at least one of the new permissions.
const ROLE_FILTER = {
  isDeleted: { $ne: true },
  $or: [{ name: { $regex: /^admin$/i } }, { isDefault: true }],
  permissions: { $not: { $all: REQUISICIONES_PERMISSIONS } },
};
const TENANT_FILTER = { 'capabilities.usesRequisiciones': { $exists: false } };

// Requisitions created before the content `version` existed (a missing version counts as 1; this makes it explicit
// so `$inc` and the stale-decision guard behave). Native collection: includes soft-deleted documents.
const VERSION_FILTER = { version: { $exists: false } };

// A tenant stored with `capabilities: null` (hand-edited data) makes the dotted-path $set below fail with
// MongoServerError code 28 and abort the script. Native collection (no casting/hooks): `$type: 'null'` matches
// only an explicit null, not a missing field. Those tenants get `capabilities: {}` first so the main write works.
export const NULL_CAPABILITIES_FILTER = Object.freeze({ capabilities: { $type: 'null' } });

export async function backfillRequisiciones({ dryRun = false } = {}) {
  const nullCapabilitiesTenants = await Tenant.collection.countDocuments({ ...NULL_CAPABILITIES_FILTER });
  const [rolesToUpdate, tenantsToUpdate, versionsToUpdate] = await Promise.all([
    Role.countDocuments(ROLE_FILTER),
    Tenant.countDocuments(TENANT_FILTER).setOptions({ includeDeleted: true }),
    Requisicion.collection.countDocuments(VERSION_FILTER),
  ]);
  console.log(
    `[backfill-requisiciones] admin roles to receive the permissions: ${rolesToUpdate}, ` +
    `tenants without usesRequisiciones: ${tenantsToUpdate}, requisiciones without version: ${versionsToUpdate}` +
    `${dryRun ? ' (dry run)' : ''}`,
  );

  const result = { rolesToUpdate, tenantsToUpdate, versionsToUpdate, nullCapabilitiesTenants, rolesUpdated: 0, tenantsUpdated: 0, versionsUpdated: 0, dryRun };
  if (dryRun) return result;

  if (versionsToUpdate > 0) {
    const r = await Requisicion.collection.updateMany(VERSION_FILTER, { $set: { version: 1 } });
    result.versionsUpdated = r.modifiedCount ?? 0;
  }

  if (rolesToUpdate > 0) {
    const r = await Role.updateMany(ROLE_FILTER, { $addToSet: { permissions: { $each: [...REQUISICIONES_PERMISSIONS] } } });
    result.rolesUpdated = r.modifiedCount ?? 0;
  }
  if (nullCapabilitiesTenants > 0) {
    await Tenant.collection.updateMany({ ...NULL_CAPABILITIES_FILTER }, { $set: { capabilities: {} } });
  }
  if (tenantsToUpdate > 0) {
    // Only this one key (dot notation): the other capability flags are never rewritten.
    const r = await Tenant.updateMany(TENANT_FILTER, { $set: { 'capabilities.usesRequisiciones': false } })
      .setOptions({ includeDeleted: true });
    result.tenantsUpdated = r.modifiedCount ?? 0;
  }
  console.log('[backfill-requisiciones] updated', result);
  return result;
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGO_URI);
  console.log('[backfill-requisiciones] Connected to MongoDB');
  try {
    await backfillRequisiciones({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((err) => {
    console.error('[backfill-requisiciones] Fatal error:', err);
    process.exit(1);
  });
}
