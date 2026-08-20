'use strict';

/**
 * One-shot: adds the new permission `customers:download-inventario` to every
 * admin-tier role across all tenants (2026-08-20).
 *
 * Context: `CUSTOMERS_DOWNLOAD_INVENTARIO` was introduced when the
 * `GET /customers/:id/inventario` endpoint stopped being gated by a
 * hardcoded `req.user.role === 'admin' || 'technician'` check inside the
 * controller and became permission-based. New tenants pick it up
 * automatically because platformTenant.service.js seeds admin roles from
 * `PERMISSION_VALUES`, but existing tenants' admin roles still lack it and
 * would otherwise silently lose access.
 *
 * Idempotent: uses `$addToSet` so re-runs are safe.
 *
 * Which roles get the backfill:
 *   - Roles named "admin" (case-insensitive) OR
 *   - Roles flagged `isDefault: true` (the tenant seed marks the Admin role
 *     this way; belt-and-suspenders in case a tenant renamed it).
 *
 * Run: `node src/scripts/2026-08-20-backfill-customers-download-inventario-permission.js`
 */

import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Role } from '../models/role.model.js';
import { PERMISSIONS } from '../constants/permissions.js';

const PERMISSION = PERMISSIONS.CUSTOMERS_DOWNLOAD_INVENTARIO;

async function main() {
  const uri = env.MONGO_URI || env.DATABASE_URL;
  if (!uri) {
    throw new Error('MONGO_URI/DATABASE_URL not set');
  }
  await mongoose.connect(uri);
  console.log(`Connected. Backfilling '${PERMISSION}' on admin roles...`);

  const filter = {
    isDeleted: { $ne: true },
    $or: [
      { name: { $regex: /^admin$/i } },
      { isDefault: true },
    ],
  };

  const targetCount = await Role.countDocuments(filter);
  console.log(`Candidate roles: ${targetCount}`);

  const result = await Role.updateMany(
    filter,
    { $addToSet: { permissions: PERMISSION } }
  );
  console.log('updateMany result:', {
    matched: result.matchedCount ?? result.n,
    modified: result.modifiedCount ?? result.nModified,
  });

  const withPerm = await Role.countDocuments({
    ...filter,
    permissions: PERMISSION,
  });
  console.log(`Admin roles now carrying '${PERMISSION}': ${withPerm} / ${targetCount}`);

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
