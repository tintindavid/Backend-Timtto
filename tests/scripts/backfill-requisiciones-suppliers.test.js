/**
 * requisiciones-e3-compras-portal, task 1.3/1.4: idempotent backfill of the two purchasing permissions (--dry-run).
 * The REAL production filter is evaluated with `sift` against a role fixture.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sift from 'sift';

import { Role } from '../../src/models/role.model.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import {
  SUPPLIERS_PERMISSIONS,
  SUPPLIERS_ROLE_FILTER,
  backfillRequisicionesSuppliers,
} from '../../scripts/2026-11-01-backfill-requisiciones-suppliers.js';

const [MS, SW] = SUPPLIERS_PERMISSIONS;
let roles;
const saved = {};
const matches = (role) => sift({ ...SUPPLIERS_ROLE_FILTER })(role);

beforeEach(() => {
  roles = [
    { _id: 'admin-lower', name: 'admin', permissions: ['users:read'] },
    { _id: 'admin-upper', name: 'ADMIN', permissions: [] },
    { _id: 'admin-half', name: 'Admin', permissions: [MS] },
    { _id: 'system-custom', name: 'Gerencia', isSystem: true, permissions: [] },
    { _id: 'default-tech', name: 'Technician', isDefault: true, permissions: [] },
    { _id: 'default-and-admin', name: 'admin', isDefault: true, permissions: [] },
    { _id: 'plain', name: 'Biomedico', permissions: ['ots:read'] },
    { _id: 'almost-admin', name: 'administrador', permissions: [] },
    { _id: 'already', name: 'admin', permissions: [MS, SW] },
    { _id: 'deleted-admin', name: 'Admin', isDeleted: true, permissions: [] },
  ];
  Object.assign(saved, { count: Role.countDocuments, update: Role.updateMany });
  Role.countDocuments = async (f) => roles.filter((r) => sift(f)(r)).length;
  Role.updateMany = async (f, u) => {
    assert.deepEqual(u, { $addToSet: { permissions: { $each: [MS, SW] } } }, 'only $addToSet of the two permissions');
    let n = 0;
    for (const r of roles.filter((x) => sift(f)(x))) {
      const before = r.permissions.length;
      for (const p of [MS, SW]) if (!r.permissions.includes(p)) r.permissions.push(p);
      if (r.permissions.length !== before) n += 1;
    }
    return { modifiedCount: n };
  };
});

afterEach(() => {
  Role.countDocuments = saved.count;
  Role.updateMany = saved.update;
});

describe('backfill requisiciones suppliers: the real filter', () => {
  it('targets the two permissions added by E3', () => {
    assert.deepEqual([...SUPPLIERS_PERMISSIONS], [PERMISSIONS.REQUISICIONES_MANAGE_SUPPLIERS, PERMISSIONS.REQUISICIONES_SELECT_WINNER]);
    assert.equal(MS, 'requisiciones:manage-suppliers');
    assert.equal(SW, 'requisiciones:select-winner');
  });

  it('matches admin/system roles missing at least one permission', () => {
    for (const id of ['admin-lower', 'admin-upper', 'admin-half', 'system-custom']) assert.equal(matches(roles.find((r) => r._id === id)), true, id);
  });

  it('never matches default roles, ordinary roles, complete roles or deleted roles', () => {
    for (const id of ['default-tech', 'default-and-admin', 'plain', 'almost-admin', 'already', 'deleted-admin']) {
      assert.equal(matches(roles.find((r) => r._id === id)), false, id);
    }
  });
});

describe('backfill requisiciones suppliers: run', () => {
  it('--dry-run counts and writes nothing', async () => {
    const out = await backfillRequisicionesSuppliers({ dryRun: true });
    assert.equal(out.rolesToUpdate, 4);
    assert.equal(out.rolesUpdated, 0);
    assert.deepEqual(roles.find((r) => r._id === 'admin-lower').permissions, ['users:read']);
  });

  it('grants both permissions only to the matched roles and keeps the existing ones', async () => {
    const out = await backfillRequisicionesSuppliers();
    assert.equal(out.rolesUpdated, 4);
    assert.deepEqual(roles.find((r) => r._id === 'admin-lower').permissions, ['users:read', MS, SW]);
    assert.deepEqual(roles.find((r) => r._id === 'admin-half').permissions, [MS, SW]);
    for (const id of ['default-tech', 'default-and-admin', 'plain', 'deleted-admin']) assert.deepEqual(roles.find((r) => r._id === id).permissions.filter((p) => p === MS || p === SW), [], id);
  });

  it('is idempotent: a second run changes nothing', async () => {
    await backfillRequisicionesSuppliers();
    const snapshot = JSON.stringify(roles);
    const again = await backfillRequisicionesSuppliers();
    assert.equal(again.rolesToUpdate, 0);
    assert.equal(again.rolesUpdated, 0);
    assert.equal(JSON.stringify(roles), snapshot);
  });
});
