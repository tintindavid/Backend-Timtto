/**
 * requisiciones-e2-solicitudes-recepcion, task 1.5: idempotent backfill of `requisiciones:receive` (--dry-run).
 * The REAL production filter (`RECEIVE_ROLE_FILTER`) is evaluated with `sift` (the Mongo query matcher Mongoose itself
 * depends on) against a role fixture, so the test exercises what runs in production, not a copy of it.
 * (tests/integration/requisicion.e2.mongo.integration.test.js runs it again against a real mongod.)
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sift from 'sift';

import { Role } from '../../src/models/role.model.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import {
  RECEIVE_PERMISSION,
  RECEIVE_ROLE_FILTER,
  backfillRequisicionesReceive,
} from '../../scripts/2026-10-27-backfill-requisiciones-receive.js';

let roles;
const saved = {};
const matches = (role) => sift({ ...RECEIVE_ROLE_FILTER })(role);

beforeEach(() => {
  roles = [
    { _id: 'admin-lower', name: 'admin', permissions: ['users:read'] },
    { _id: 'admin-title', name: 'Admin', permissions: [] },
    { _id: 'admin-upper', name: 'ADMIN', permissions: ['x'] },
    { _id: 'system-custom', name: 'Gerencia', isSystem: true, permissions: ['users:read'] },
    { _id: 'system-explicit-false-default', name: 'Soporte', isSystem: true, isDefault: false, permissions: [] },
    { _id: 'default-tech', name: 'Technician', isDefault: true, isSystem: false, permissions: [] },
    { _id: 'default-and-admin', name: 'admin', isDefault: true, permissions: [] },
    { _id: 'default-and-system', name: 'Base', isDefault: true, isSystem: true, permissions: [] },
    { _id: 'plain', name: 'Biomedico', permissions: ['ots:read'] },
    { _id: 'almost-admin', name: 'administrador', permissions: [] },
    { _id: 'admin-substring', name: 'sub-admin', permissions: [] },
    { _id: 'already', name: 'admin', permissions: ['users:read', RECEIVE_PERMISSION] },
    { _id: 'deleted-admin', name: 'Admin', isDeleted: true, permissions: [] },
  ];
  Object.assign(saved, { count: Role.countDocuments, update: Role.updateMany });
  Role.countDocuments = async (f) => roles.filter((r) => sift(f)(r)).length;
  Role.updateMany = async (f, u) => {
    assert.deepEqual(u, { $addToSet: { permissions: RECEIVE_PERMISSION } }, 'only $addToSet of the one permission');
    let n = 0;
    for (const r of roles.filter((x) => sift(f)(x))) {
      if (!r.permissions.includes(RECEIVE_PERMISSION)) { r.permissions.push(RECEIVE_PERMISSION); n += 1; }
    }
    return { modifiedCount: n };
  };
});

afterEach(() => {
  Role.countDocuments = saved.count;
  Role.updateMany = saved.update;
});

describe('backfill requisiciones:receive: the real filter', () => {
  it('targets the permission added by this change', () => {
    assert.equal(RECEIVE_PERMISSION, PERMISSIONS.REQUISICIONES_RECEIVE);
    assert.equal(RECEIVE_PERMISSION, 'requisiciones:receive');
  });

  it('matches admin (any case) and system roles that still lack the permission', () => {
    for (const id of ['admin-lower', 'admin-title', 'admin-upper', 'system-custom', 'system-explicit-false-default']) {
      assert.equal(matches(roles.find((r) => r._id === id)), true, id);
    }
  });

  it('NEVER matches a role marked isDefault, even if it is also admin or system', () => {
    for (const id of ['default-tech', 'default-and-admin', 'default-and-system']) {
      assert.equal(matches(roles.find((r) => r._id === id)), false, id);
    }
  });

  it('does not match ordinary roles, near-miss names, roles that already have it, or deleted roles', () => {
    for (const id of ['plain', 'almost-admin', 'admin-substring', 'already', 'deleted-admin']) {
      assert.equal(matches(roles.find((r) => r._id === id)), false, id);
    }
  });
});

describe('backfill requisiciones:receive: run', () => {
  it('--dry-run counts and writes nothing', async () => {
    const out = await backfillRequisicionesReceive({ dryRun: true });
    assert.equal(out.rolesToUpdate, 5);
    assert.equal(out.rolesUpdated, 0);
    assert.equal(out.dryRun, true);
    assert.equal(roles.some((r) => r.permissions.includes(RECEIVE_PERMISSION) && r._id !== 'already'), false);
  });

  it('grants the permission only to the matched roles, keeps their existing permissions, and never touches default roles', async () => {
    const out = await backfillRequisicionesReceive();
    assert.equal(out.rolesUpdated, 5);
    const granted = roles.filter((r) => r.permissions.includes(RECEIVE_PERMISSION)).map((r) => r._id).sort();
    assert.deepEqual(granted, ['already', 'admin-lower', 'admin-title', 'admin-upper', 'system-custom', 'system-explicit-false-default'].sort());
    assert.deepEqual(roles.find((r) => r._id === 'admin-lower').permissions, ['users:read', RECEIVE_PERMISSION]);
    for (const id of ['default-tech', 'default-and-admin', 'default-and-system', 'plain', 'deleted-admin']) {
      assert.deepEqual(roles.find((r) => r._id === id).permissions.filter((p) => p === RECEIVE_PERMISSION), [], id);
    }
  });

  it('is idempotent: a second run matches and changes nothing', async () => {
    await backfillRequisicionesReceive();
    const snapshot = JSON.stringify(roles);
    const again = await backfillRequisicionesReceive();
    assert.equal(again.rolesToUpdate, 0);
    assert.equal(again.rolesUpdated, 0);
    assert.equal(JSON.stringify(roles), snapshot);
  });
});
