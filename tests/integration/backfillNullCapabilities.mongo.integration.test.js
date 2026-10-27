/**
 * Backfills must not abort on a tenant stored with `capabilities: null` (managesCustomers adversarial #7).
 * SKIPPED unless MONGO_INTEGRATION_URI is set; throwaway standalone mongod only (see ownCustomer.mongo.integration.test.js).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Tenant } from '../../src/models/tenant.model.js';
import { backfillManagesCustomers } from '../../scripts/2026-10-26-backfill-manages-customers.js';
import { backfillRequisiciones } from '../../scripts/2026-10-25-backfill-requisiciones.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);

describe('backfills with capabilities: null against a real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  before(async () => {
    await mongoose.connect(URI, { dbName: `bf_null_${rnd()}` });
    await Tenant.collection.insertMany([
      { tenantId: 'null-caps', name: 'Null', capabilities: null },
      { tenantId: 'legacy', name: 'Legacy' },
      { tenantId: 'client', name: 'Client', capabilities: { executesServices: false, registersExternal: true } },
    ]);
  });

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  it('managesCustomers backfill completes, normalizes null and is idempotent', async () => {
    const r = await backfillManagesCustomers();
    assert.equal(r.nullCapabilitiesTenants, 1);
    assert.equal(r.tenantsUpdated, 2);
    const t = await Tenant.collection.findOne({ tenantId: 'null-caps' });
    assert.equal(t.capabilities.managesCustomers, true);
    const client = await Tenant.collection.findOne({ tenantId: 'client' });
    assert.equal(client.capabilities.managesCustomers, undefined);
    assert.equal((await backfillManagesCustomers()).tenantsUpdated, 0);
  });

  it('requisiciones backfill completes with a null-capabilities tenant', async () => {
    await Tenant.collection.updateOne({ tenantId: 'legacy' }, { $set: { capabilities: null } });
    const r = await backfillRequisiciones();
    assert.equal(r.nullCapabilitiesTenants, 1);
    const t = await Tenant.collection.findOne({ tenantId: 'legacy' });
    assert.equal(t.capabilities.usesRequisiciones, false);
  });
});
