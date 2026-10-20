/**
 * tests/scripts/backfill-tenant-capabilities.test.js
 * tenant-capabilities-hybrid-mode, task 3.3. DB-free: Tenant statics are stubbed.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Tenant } from '../../src/models/tenant.model.js';
import { backfillTenantCapabilities } from '../../scripts/2026-10-13-backfill-tenant-capabilities.js';

const DEFAULTS = { executesServices: true, registersExternal: false };

describe('backfillTenantCapabilities', () => {
  afterEach(() => { delete Tenant.countDocuments; delete Tenant.updateMany; });

  it('dry run counts (soft-deleted included) but writes nothing', async () => {
    let wrote = false;
    let filter = null;
    Tenant.countDocuments = (f) => {
      filter = f;
      return { setOptions: (o) => { assert.equal(o.includeDeleted, true); return Promise.resolve(4); } };
    };
    Tenant.updateMany = () => { wrote = true; return { setOptions: () => Promise.resolve({ modifiedCount: 4 }) }; };
    const r = await backfillTenantCapabilities({ dryRun: true });
    assert.deepEqual(filter, { capabilities: { $exists: false } });
    assert.equal(r.matched, 4);
    assert.equal(r.updated, 0);
    assert.equal(r.dryRun, true);
    assert.equal(wrote, false);
  });

  it('writes the explicit defaults on tenants lacking capabilities', async () => {
    let args = null;
    Tenant.countDocuments = () => ({ setOptions: () => Promise.resolve(2) });
    Tenant.updateMany = (f, u) => { args = { f, u }; return { setOptions: () => Promise.resolve({ modifiedCount: 2 }) }; };
    const r = await backfillTenantCapabilities();
    assert.deepEqual(args.f, { capabilities: { $exists: false } });
    assert.deepEqual(args.u, { $set: { capabilities: DEFAULTS } });
    assert.equal(r.updated, 2);
  });

  it('is idempotent: a second run updates zero', async () => {
    let remaining = 2;
    Tenant.countDocuments = () => ({ setOptions: () => Promise.resolve(remaining) });
    Tenant.updateMany = () => ({
      setOptions: () => { const n = remaining; remaining = 0; return Promise.resolve({ modifiedCount: n }); },
    });
    assert.equal((await backfillTenantCapabilities()).updated, 2);
    assert.equal((await backfillTenantCapabilities()).updated, 0);
  });

  it('never touches organizationCustomerId', async () => {
    let update = null;
    Tenant.countDocuments = () => ({ setOptions: () => Promise.resolve(1) });
    Tenant.updateMany = (_f, u) => { update = u; return { setOptions: () => Promise.resolve({ modifiedCount: 1 }) }; };
    await backfillTenantCapabilities();
    assert.deepEqual(Object.keys(update.$set), ['capabilities']);
  });
});
