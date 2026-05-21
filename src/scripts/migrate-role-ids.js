'use strict';

import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Role } from '../models/role.model.js';
import { User } from '../models/user.model.js';
import { PERMISSIONS } from '../constants/permissions.js';

const ROLE_SEEDS = [
  { name: 'Admin', description: 'Tenant administrator', permissions: Object.values(PERMISSIONS), isDefault: false },
  { name: 'Technician', description: 'Field technician', permissions: [PERMISSIONS.USERS_READ, PERMISSIONS.REPORTS_READ, PERMISSIONS.OTS_READ], isDefault: true },
  { name: 'User', description: 'Basic user', permissions: [PERMISSIONS.REPORTS_READ], isDefault: true },
];

async function main() {
  await mongoose.connect(env.MONGO_URI || env.DATABASE_URL);

  const users = await User.find({ isDeleted: false }).lean();
  const tenantIds = [...new Set(users.map((user) => user.tenantId))];

  for (const tenantId of tenantIds) {
    const existingRoles = await Role.find({ tenantId }).lean();
    const roleMap = new Map(existingRoles.map((role) => [role.name.toLowerCase(), role]));

    for (const seed of ROLE_SEEDS) {
      if (!roleMap.has(seed.name.toLowerCase())) {
        const created = await Role.create({ tenantId, ...seed });
        roleMap.set(seed.name.toLowerCase(), created.toJSON());
      }
    }

    for (const user of users.filter((candidate) => candidate.tenantId === tenantId)) {
      const seedName = user.role === 'admin' ? 'Admin' : user.role === 'technician' ? 'Technician' : 'User';
      const role = roleMap.get(seedName.toLowerCase());
      if (role) {
        await User.updateOne({ _id: user._id }, { $set: { roleId: role._id } });
      }
    }
  }

  await mongoose.disconnect();
  console.log('Role migration completed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});