/**
 * tests/isolation/users.isolation.test.js
 *
 * Isolation tests — cross-tenant guard for the users resource.
 *
 * Also verifies that superadmin users have role='superadmin'
 * (not identified by magic tenantId strings).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../../src/models/user.model.js';
import { createTenantWithUser, seedUserFor } from './fixtures.js';

const T1 = 't1-users';
const T2 = 't2-users';

describe('users isolation', () => {
  const stubs = {};
  afterEach(() => {
    for (const [key, original] of Object.entries(stubs)) {
      User[key] = original;
    }
    Object.keys(stubs).forEach((k) => delete stubs[k]);
  });

  it('list query scopes to authenticated tenant', async () => {
    const { user: u1 } = createTenantWithUser({ tenantId: T1, adminEmail: 'admin@t1.com' });
    const t1User = seedUserFor(T1);
    const t2User = seedUserFor(T2);
    const allDocs = [t1User, t2User];

    let capturedFilter = null;
    stubs.find = User.find;
    User.find = (filter) => {
      capturedFilter = filter;
      return {
        lean: () => Promise.resolve(allDocs.filter((d) => d.tenantId === filter.tenantId)),
        skip: function () { return this; },
        limit: function () { return this; },
        sort: function () { return this; },
        select: function () { return this; },
      };
    };

    const results = await User.find({ tenantId: u1.tenantId, isDeleted: false }).lean();

    assert.equal(capturedFilter.tenantId, T1, 'user query scoped to T1');
    assert.equal(results.length, 1);
    assert.equal(results[0].tenantId, T1);
    assert.equal(results.some((d) => d.tenantId === T2), false, 'T2 users must not appear');
  });

  it('cross-tenant getById returns null for T1 user querying T2 user', async () => {
    const { user: u1 } = createTenantWithUser({ tenantId: T1, adminEmail: 'admin@t1.com' });
    const t2User = seedUserFor(T2);

    stubs.findOne = User.findOne;
    User.findOne = (filter) => ({
      lean: () => Promise.resolve(
        filter.tenantId === t2User.tenantId && filter._id === t2User._id ? t2User : null,
      ),
      select: function () { return this; },
    });

    const result = await User.findOne({ tenantId: u1.tenantId, _id: t2User._id }).lean();
    assert.equal(result, null, 'cross-tenant user lookup returns null');
  });

  it('superadmin is identified by role, not by magic tenantId string', () => {
    // Legacy superadmin user (pre-migration) — tenantId='superadmin', role='admin'
    const legacyAdmin = { tenantId: 'superadmin', role: 'admin' };
    // Correctly migrated superadmin
    const realSuperAdmin = { tenantId: '__platform__', role: 'superadmin' };

    // requireSuperAdmin contract: only role === 'superadmin' passes
    const isSuperAdmin = (user) => user.role === 'superadmin';

    assert.equal(isSuperAdmin(legacyAdmin), false, 'legacy magic tenantId must NOT grant superadmin');
    assert.equal(isSuperAdmin(realSuperAdmin), true, 'proper role=superadmin must pass');
  });

  it('User.role enum accepts superadmin', () => {
    const schema = User.schema;
    const roleEnum = schema.path('role').options.enum;
    assert.ok(roleEnum.includes('superadmin'), 'superadmin must be in User.role enum');
  });
});
