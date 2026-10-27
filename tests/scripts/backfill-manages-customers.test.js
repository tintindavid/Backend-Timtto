/**
 * requisiciones-e1-base-aprobacion: managesCustomers backfill (idempotent, --dry-run).
 * DB-free: Tenant statics are stubbed with a tiny in-memory store that mimics the filter.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Tenant } from '../../src/models/tenant.model.js';
import { backfillManagesCustomers, MANAGES_CUSTOMERS_FILTER } from '../../scripts/2026-10-26-backfill-manages-customers.js';

let tenants;
const saved = {};

// Same semantics as MANAGES_CUSTOMERS_FILTER.
const matches = (t) => t.capabilities?.managesCustomers === undefined && t.capabilities?.executesServices !== false;

beforeEach(() => {
  tenants = [
    { _id: 't1' }, // no capabilities at all: provider by default
    { _id: 't2', capabilities: { executesServices: true, registersExternal: false } },
    { _id: 't3', capabilities: { executesServices: false, registersExternal: true } }, // client: untouched
    { _id: 't4', capabilities: { executesServices: true, managesCustomers: false } }, // explicit: untouched
    { _id: 't5', capabilities: { executesServices: true, managesCustomers: true, usesQrs: true } },
    { _id: 't6', isDeleted: true, capabilities: { executesServices: true, registersExternal: true, usesInventoryBasic: true } },
  ];
  Object.assign(saved, { count: Tenant.countDocuments, update: Tenant.updateMany });
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
  const ops = (fn) => ({ setOptions: (o) => { assert.equal(o.includeDeleted, true, 'soft-deleted tenants are included'); return Promise.resolve(fn()); } });
  Tenant.countDocuments = (filter) => {
    assert.deepEqual(filter, MANAGES_CUSTOMERS_FILTER);
    return ops(() => tenants.filter(matches).length);
  };
  Tenant.updateMany = (filter, update) => ops(() => {
    assert.deepEqual(filter, MANAGES_CUSTOMERS_FILTER);
    assert.deepEqual(update, { $set: { 'capabilities.managesCustomers': true } }, 'only that key is written');
    let n = 0;
    // Emulates MongoServerError code 28: a dotted-path $set cannot traverse a null parent.
    if (tenants.some((t) => t.capabilities === null)) throw new Error('Cannot create field managesCustomers in element {capabilities: null}');
    for (const t of tenants.filter(matches)) { t.capabilities = { ...(t.capabilities || {}), managesCustomers: true }; n += 1; }
    return { modifiedCount: n };
  });
});

afterEach(() => {
  Tenant.countDocuments = saved.count;
  Tenant.updateMany = saved.update;
  Object.defineProperty(Tenant, 'collection', saved.tCollection);
});

describe('backfillManagesCustomers', () => {
  it('--dry-run counts but writes nothing', async () => {
    const r = await backfillManagesCustomers({ dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(r.tenantsToUpdate, 3);
    assert.equal(r.tenantsUpdated, 0);
    assert.equal(tenants[0].capabilities, undefined);
    assert.equal(tenants[1].capabilities.managesCustomers, undefined);
  });

  it('sets managesCustomers=true only where executesServices and the flag is missing (soft-deleted included)', async () => {
    const r = await backfillManagesCustomers();
    assert.equal(r.tenantsUpdated, 3);
    assert.equal(tenants[0].capabilities.managesCustomers, true);
    assert.equal(tenants[1].capabilities.managesCustomers, true);
    assert.equal(tenants[5].capabilities.managesCustomers, true);
    assert.equal(tenants[5].capabilities.usesInventoryBasic, true, 'other flags are not touched');
    assert.equal(tenants[2].capabilities.managesCustomers, undefined, 'a client tenant is untouched');
    assert.equal(tenants[3].capabilities.managesCustomers, false, 'an explicit false is never overwritten');
    assert.equal(tenants[4].capabilities.managesCustomers, true);
  });

  it('is idempotent: a second run matches and changes nothing', async () => {
    await backfillManagesCustomers();
    const second = await backfillManagesCustomers();
    assert.equal(second.tenantsToUpdate, 0);
    assert.equal(second.tenantsUpdated, 0);
  });

  it('does not abort on a tenant stored with capabilities null (normalized to {} first); dry-run reports it', async () => {
    tenants.push({ _id: 't7', capabilities: null });
    const dry = await backfillManagesCustomers({ dryRun: true });
    assert.equal(dry.nullCapabilitiesTenants, 1);
    assert.equal(tenants[6].capabilities, null, 'dry run writes nothing');
    const r = await backfillManagesCustomers();
    assert.equal(r.tenantsUpdated, 4);
    assert.equal(tenants[6].capabilities.managesCustomers, true);
    const second = await backfillManagesCustomers();
    assert.equal(second.tenantsUpdated, 0);
  });
});
