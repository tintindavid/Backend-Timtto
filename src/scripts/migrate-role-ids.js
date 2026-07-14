'use strict';

/**
 * One-shot migration: seeds "Admin", "Technician", "User" roles per tenant and
 * assigns each existing user a roleId based on their legacy `role` enum value.
 *
 * Idempotent:
 *   - Roles that already exist (matched by lowercased name) are reused.
 *   - Users with a roleId already set are skipped.
 *   - "Admin" is upgraded to isSystem=true and gets the full permission catalog
 *     even if it existed before (so new permissions ship to tenants without
 *     manual re-selection).
 *
 * Run: `node src/scripts/migrate-role-ids.js`
 */

import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Role } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { PERMISSIONS, PERMISSION_VALUES } from '../constants/permissions.js';

const ROLE_SEEDS = [
  {
    name: 'Admin',
    description: 'Tenant administrator',
    permissions: PERMISSION_VALUES,
    isSystem: true,
    isDefault: false,
  },
  {
    name: 'Technician',
    description: 'Field technician',
    permissions: [
      PERMISSIONS.OTS_READ,
      PERMISSIONS.OTS_UPDATE,
      PERMISSIONS.REPORTS_READ,
      PERMISSIONS.REPORTS_CREATE,
      PERMISSIONS.REPORTS_UPDATE,
      PERMISSIONS.REPORTS_PDF,
      PERMISSIONS.EQUIPO_ITEMS_READ,
      PERMISSIONS.HV_EQUIPOS_READ,
      PERMISSIONS.CUSTOMERS_READ,
      PERMISSIONS.SEDES_READ,
      PERMISSIONS.CRONOGRAMAS_READ,
    ],
    isSystem: false,
    isDefault: true,
  },
  {
    name: 'User',
    description: 'Basic user',
    permissions: [PERMISSIONS.REPORTS_READ, PERMISSIONS.OTS_READ],
    isSystem: false,
    isDefault: false,
  },
];

/**
 * Tenants excluded from RBAC seeding:
 *   - `__platform__` hosts SuperAdmin operators. They bypass tenant RBAC via
 *     `req.user.role === 'superadmin'`; seeding Admin/Technician/User for the
 *     platform tenant would pollute /roles UI without any effect.
 */
const EXCLUDED_TENANT_IDS = new Set(['__platform__']);

async function main() {
  await mongoose.connect(env.MONGO_URI || env.DATABASE_URL);

  const users = await User.find({ isDeleted: false }).lean();

  const tenantIds = [
    ...new Set(
      users
        .map((user) => (typeof user.tenantId === 'string' ? user.tenantId.trim() : ''))
        .filter((tenantId) => tenantId && !EXCLUDED_TENANT_IDS.has(tenantId)),
    ),
  ];

  let rolesSeeded = 0;
  let usersUpdated = 0;
  let usersSkipped = 0;

  for (const tenantId of tenantIds) {
    const existingRoles = await Role.find({ tenantId }).lean();
    const roleMap = new Map(existingRoles.map((role) => [role.name.toLowerCase(), role]));

    for (const seed of ROLE_SEEDS) {
      const key = seed.name.toLowerCase();
      if (!roleMap.has(key)) {
        const created = await Role.create({ tenantId, ...seed });
        roleMap.set(key, created.toObject());
        rolesSeeded += 1;
      } else if (seed.isSystem && !roleMap.get(key).isSystem) {
        await Role.updateOne(
          { _id: roleMap.get(key)._id },
          { $set: { isSystem: true, permissions: seed.permissions } },
        );
      }
    }

    const tenantUsers = users.filter((candidate) => candidate.tenantId === tenantId);
    for (const user of tenantUsers) {
      if (user.roleId) continue;
      // Users flagged as platform superadmin never get a tenant roleId; RBAC bypasses them.
      if (user.role === 'superadmin') {
        usersSkipped += 1;
        continue;
      }
      const seedName = user.role === 'admin' ? 'Admin' : user.role === 'technician' ? 'Technician' : 'User';
      const role = roleMap.get(seedName.toLowerCase());
      if (!role) continue;
      await User.updateOne({ _id: user._id }, { $set: { roleId: role._id } });
      usersUpdated += 1;
    }
  }

  await mongoose.disconnect();
  console.log(
    `Role migration completed — roles seeded: ${rolesSeeded}, users updated: ${usersUpdated}, superadmin/platform users skipped: ${usersSkipped}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
