/**
 * requisiciones-e1-base-aprobacion, task 1.5/1.6: idempotent permission + capability backfill (--dry-run).
 * DB-free: Role / Tenant statics are stubbed with a tiny in-memory store.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Role } from '../../src/models/role.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { ROLE_FILTER, backfillRequisiciones, REQUISICIONES_PERMISSIONS } from '../../scripts/2026-10-25-backfill-requisiciones.js';

let roles;
let tenants;
let reqs;
const saved = {};

// Admin tier = a role named admin or the seeded system role. NEVER isDefault (it is the ordinary users' role).
const isAdminTier = (r) => !r.isDeleted && (/^admin$/i.test(r.name) || r.isSystem === true);
const missesSome = (r) => !REQUISICIONES_PERMISSIONS.every((p) => r.permissions.includes(p));
const roleMatches = (r) => isAdminTier(r) && missesSome(r);
const tenantMatches = (t) => t.capabilities?.usesRequisiciones === undefined;

beforeEach(() => {
  roles = [
    { _id: 'r1', name: 'Admin', permissions: ['users:read'] },
    { _id: 'r2', name: 'Biomedico', permissions: ['ots:read'] },
    { _id: 'r3', name: 'Technician', isDefault: true, isSystem: false, permissions: ['ots:read'] },
    { _id: 'r4', name: 'admin', permissions: [...REQUISICIONES_PERMISSIONS, 'users:read'] },
    { _id: 'r5', name: 'Admin', isDeleted: true, permissions: [] },
    { _id: 'r6', name: 'Propietario', isSystem: true, permissions: ['users:read'] },
  ];
  tenants = [
    { _id: 't1' },
    { _id: 't2', capabilities: { executesServices: true, usesInventoryBasic: true } },
    { _id: 't3', capabilities: { usesRequisiciones: true } },
    { _id: 't4', capabilities: { usesRequisiciones: false } },
  ];
  Object.assign(saved, {
    roleCount: Role.countDocuments,
    roleUpdate: Role.updateMany,
    tCount: Tenant.countDocuments,
    tUpdate: Tenant.updateMany,
  });
  reqs = [{ _id: 'q1' }, { _id: 'q2', version: 3 }, { _id: 'q3', isDeleted: true }];
  saved.collection = Object.getOwnPropertyDescriptor(Requisicion, 'collection');
  Object.defineProperty(Requisicion, 'collection', {
    configurable: true,
    value: {
      countDocuments: async (f) => { assert.deepEqual(f, { version: { $exists: false } }); return reqs.filter((q) => q.version === undefined).length; },
      updateMany: async (f, u) => {
        assert.deepEqual(u, { $set: { version: 1 } });
        let n = 0;
        for (const q of reqs.filter((x) => x.version === undefined)) { q.version = 1; n += 1; }
        return { modifiedCount: n };
      },
    },
  });
  // Native collection used by the `capabilities: null` pre-pass (an explicit null is NOT a missing field).
  saved.tCollection = Object.getOwnPropertyDescriptor(Tenant, 'collection');
  Object.defineProperty(Tenant, 'collection', {
    configurable: true,
    value: {
      countDocuments: async (f) => { assert.deepEqual(f, { capabilities: { $type: 'null' } }); return tenants.filter((t) => t.capabilities === null).length; },
      updateMany: async (f, u) => {
        assert.deepEqual(f, { capabilities: { $type: 'null' } });
        assert.deepEqual(u, { $set: { capabilities: {} } });
        let n = 0;
        for (const t of tenants.filter((x) => x.capabilities === null)) { t.capabilities = {}; n += 1; }
        return { modifiedCount: n };
      },
    },
  });
  Role.countDocuments = async () => roles.filter(roleMatches).length;
  Role.updateMany = async (_filter, update) => {
    let n = 0;
    for (const r of roles.filter(roleMatches)) {
      for (const p of update.$addToSet.permissions.$each) if (!r.permissions.includes(p)) r.permissions.push(p);
      n += 1;
    }
    return { modifiedCount: n };
  };
  const tenantOps = (fn) => ({ setOptions: (o) => { assert.equal(o.includeDeleted, true, 'soft-deleted tenants are included'); return Promise.resolve(fn()); } });
  Tenant.countDocuments = () => tenantOps(() => tenants.filter(tenantMatches).length);
  Tenant.updateMany = (_f, update) => tenantOps(() => {
    assert.deepEqual(Object.keys(update.$set), ['capabilities.usesRequisiciones'], 'only that key is written');
    // Emulates MongoServerError code 28: a dotted-path $set cannot traverse a null parent.
    if (tenants.some((t) => t.capabilities === null)) throw new Error('Cannot create field usesRequisiciones in element {capabilities: null}');
    let n = 0;
    for (const t of tenants.filter(tenantMatches)) {
      t.capabilities = { ...(t.capabilities || {}), usesRequisiciones: update.$set['capabilities.usesRequisiciones'] };
      n += 1;
    }
    return { modifiedCount: n };
  });
});

afterEach(() => {
  Object.defineProperty(Requisicion, 'collection', saved.collection);
  Role.countDocuments = saved.roleCount;
  Role.updateMany = saved.roleUpdate;
  Tenant.countDocuments = saved.tCount;
  Tenant.updateMany = saved.tUpdate;
  Object.defineProperty(Tenant, 'collection', saved.tCollection);
});

describe('backfillRequisiciones', () => {
  it('covers every requisiciones/areas/approval-rules/budgets/request-types permission', () => {
    assert.equal(REQUISICIONES_PERMISSIONS.length, 24);
    assert.ok(REQUISICIONES_PERMISSIONS.includes('requisiciones:approve'));
    assert.ok(REQUISICIONES_PERMISSIONS.includes('request-types:delete'));
  });

  it('--dry-run counts but writes nothing', async () => {
    const r = await backfillRequisiciones({ dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(r.rolesToUpdate, 2);
    assert.equal(r.tenantsToUpdate, 2);
    assert.equal(r.rolesUpdated, 0);
    assert.equal(r.tenantsUpdated, 0);
    assert.deepEqual(roles[0].permissions, ['users:read']);
    assert.equal(tenants[0].capabilities, undefined);
    assert.equal(r.versionsToUpdate, 2);
    assert.equal(r.versionsUpdated, 0);
    assert.equal(reqs[0].version, undefined, 'dry run writes nothing');
  });

  it('sets version 1 where missing (soft-deleted included), keeps existing versions, and is idempotent', async () => {
    const r = await backfillRequisiciones();
    assert.equal(r.versionsUpdated, 2);
    assert.deepEqual(reqs.map((q) => q.version), [1, 3, 1]);
    const second = await backfillRequisiciones();
    assert.equal(second.versionsToUpdate, 0);
    assert.equal(second.versionsUpdated, 0);
  });

  it('adds the permissions to admin-tier roles only and sets usesRequisiciones=false where missing', async () => {
    const r = await backfillRequisiciones();
    assert.equal(r.rolesUpdated, 2);
    assert.equal(r.tenantsUpdated, 2);
    assert.ok(REQUISICIONES_PERMISSIONS.every((p) => roles[0].permissions.includes(p)));
    assert.ok(roles[0].permissions.includes('users:read'), 'existing permissions are kept');
    assert.deepEqual(roles[2].permissions, ['ots:read'], 'a default role (Technician) NEVER receives the permissions');
    assert.ok(REQUISICIONES_PERMISSIONS.every((p) => roles[5].permissions.includes(p)), 'seeded system role');
    assert.deepEqual(roles[1].permissions, ['ots:read'], 'non-admin role untouched');
    assert.deepEqual(roles[4].permissions, [], 'deleted role untouched');
    assert.equal(tenants[0].capabilities.usesRequisiciones, false);
    assert.equal(tenants[1].capabilities.usesRequisiciones, false);
    assert.equal(tenants[1].capabilities.usesInventoryBasic, true, 'other flags are not touched');
    assert.equal(tenants[2].capabilities.usesRequisiciones, true, 'an explicit value is never overwritten');
  });

  it('is idempotent: a second run matches and changes nothing', async () => {
    await backfillRequisiciones();
    const second = await backfillRequisiciones();
    assert.equal(second.rolesToUpdate, 0);
    assert.equal(second.tenantsToUpdate, 0);
    assert.equal(second.rolesUpdated, 0);
    assert.equal(second.tenantsUpdated, 0);
    assert.equal(roles[0].permissions.filter((p) => p === 'areas:read').length, 1, 'no duplicates');
  });

  it('does not abort on a tenant stored with capabilities null (normalized to {} first)', async () => {
    tenants.push({ _id: 't5', capabilities: null });
    const dry = await backfillRequisiciones({ dryRun: true });
    assert.equal(dry.nullCapabilitiesTenants, 1);
    assert.equal(tenants[4].capabilities, null, 'dry run writes nothing');
    const r = await backfillRequisiciones();
    assert.equal(r.tenantsUpdated, 3);
    assert.equal(tenants[4].capabilities.usesRequisiciones, false);
  });
});

describe('ROLE_FILTER (the real filter used by the script)', () => {
  it('targets admin / system roles and never the default role of a tenant', () => {
    const text = JSON.stringify(ROLE_FILTER, (_, v) => (v instanceof RegExp ? `regex:${v.source}` : v));
    assert.match(text, /isSystem/);
    assert.match(text, /regex:\^admin\$/);
    assert.doesNotMatch(text, /isDefault/, 'isDefault is the ordinary users role (e.g. Technician)');
  });
});
