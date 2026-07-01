/**
 * tests/isolation/equipoitems.isolation.test.js
 *
 * Isolation tests — cross-tenant guard for the equipoitems resource.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { createTenantWithUser, seedEquipoFor } from './fixtures.js';

const T1 = 't1-equipo';
const T2 = 't2-equipo';

describe('equipoitems isolation', () => {
  const stubs = {};
  afterEach(() => {
    for (const [key, original] of Object.entries(stubs)) {
      EquipoItem[key] = original;
    }
    Object.keys(stubs).forEach((k) => delete stubs[k]);
  });

  it('list query scopes to authenticated tenant', async () => {
    const { user: u1 } = createTenantWithUser({ tenantId: T1, adminEmail: 'admin@t1.com' });
    const t1Equipo = seedEquipoFor(T1);
    const t2Equipo = seedEquipoFor(T2);
    const allDocs = [t1Equipo, t2Equipo];

    let capturedFilter = null;
    stubs.find = EquipoItem.find;
    EquipoItem.find = (filter) => {
      capturedFilter = filter;
      return {
        lean: () => Promise.resolve(allDocs.filter((d) => d.tenantId === filter.tenantId)),
        skip: function () { return this; },
        limit: function () { return this; },
        sort: function () { return this; },
        populate: function () { return this; },
      };
    };

    const results = await EquipoItem.find({ tenantId: u1.tenantId, isDeleted: false }).lean();

    assert.equal(capturedFilter.tenantId, T1, 'query scoped to T1');
    assert.equal(results.length, 1);
    assert.equal(results[0].tenantId, T1);
    assert.equal(results.some((d) => d.tenantId === T2), false, 'T2 equipo must not appear');
  });

  it('cross-tenant getById returns null for T1 user querying T2 equipo', async () => {
    const { user: u1 } = createTenantWithUser({ tenantId: T1, adminEmail: 'admin@t1.com' });
    const t2Equipo = seedEquipoFor(T2);

    stubs.findOne = EquipoItem.findOne;
    EquipoItem.findOne = (filter) => ({
      lean: () => Promise.resolve(
        filter.tenantId === t2Equipo.tenantId && filter._id === t2Equipo._id ? t2Equipo : null,
      ),
      populate: function () { return this; },
    });

    const result = await EquipoItem.findOne({ tenantId: u1.tenantId, _id: t2Equipo._id }).lean();
    assert.equal(result, null, 'cross-tenant equipo lookup returns null');
  });
});
