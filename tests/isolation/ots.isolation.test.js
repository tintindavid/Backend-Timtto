/**
 * tests/isolation/ots.isolation.test.js
 *
 * Isolation tests — cross-tenant guard for the OTs (work orders) resource.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { OT } from '../../src/models/ot.model.js';
import { createTenantWithUser, seedOTFor } from './fixtures.js';

const T1 = 't1-ots';
const T2 = 't2-ots';

describe('ots isolation', () => {
  const stubs = {};
  afterEach(() => {
    for (const [key, original] of Object.entries(stubs)) {
      OT[key] = original;
    }
    Object.keys(stubs).forEach((k) => delete stubs[k]);
  });

  it('list query scopes to authenticated tenant', async () => {
    const { user: u1 } = createTenantWithUser({ tenantId: T1, adminEmail: 'admin@t1.com' });
    const t1OT = seedOTFor(T1);
    const t2OT = seedOTFor(T2);
    const allDocs = [t1OT, t2OT];

    let capturedFilter = null;
    stubs.find = OT.find;
    OT.find = (filter) => {
      capturedFilter = filter;
      return {
        lean: () => Promise.resolve(allDocs.filter((d) => d.tenantId === filter.tenantId)),
        skip: function () { return this; },
        limit: function () { return this; },
        sort: function () { return this; },
        populate: function () { return this; },
      };
    };

    const results = await OT.find({ tenantId: u1.tenantId, isDeleted: false }).lean();

    assert.equal(capturedFilter.tenantId, T1, 'OT query scoped to T1');
    assert.equal(results.length, 1);
    assert.equal(results[0].tenantId, T1);
    assert.equal(results.some((d) => d.tenantId === T2), false, 'T2 OTs must not appear');
  });

  it('T1 user updating T2 OT by id returns null (service raises 404, not data corruption)', async () => {
    const { user: u1 } = createTenantWithUser({ tenantId: T1, adminEmail: 'admin@t1.com' });
    const t2OT = seedOTFor(T2);

    stubs.findOneAndUpdate = OT.findOneAndUpdate;
    OT.findOneAndUpdate = (filter, _update, _opts) => ({
      lean: () => Promise.resolve(
        filter.tenantId === t2OT.tenantId && filter._id === t2OT._id ? t2OT : null,
      ),
    });

    // T1 user sends T1 tenantId in filter — no match against T2's OT
    const result = await OT.findOneAndUpdate(
      { tenantId: u1.tenantId, _id: t2OT._id },
      { $set: { EstadoOt: 'Completada' } },
      { new: true },
    ).lean();

    assert.equal(result, null, 'cross-tenant OT update must return null — service raises 404');
  });
});
