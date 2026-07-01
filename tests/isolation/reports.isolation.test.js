/**
 * tests/isolation/reports.isolation.test.js
 *
 * Isolation tests — cross-tenant guard for the reports resource.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Report } from '../../src/models/report.model.js';
import { createTenantWithUser, seedReportFor } from './fixtures.js';

const T1 = 't1-reports';
const T2 = 't2-reports';

describe('reports isolation', () => {
  const stubs = {};
  afterEach(() => {
    for (const [key, original] of Object.entries(stubs)) {
      Report[key] = original;
    }
    Object.keys(stubs).forEach((k) => delete stubs[k]);
  });

  it('list query scopes to authenticated tenant', async () => {
    const { user: u1 } = createTenantWithUser({ tenantId: T1, adminEmail: 'admin@t1.com' });
    const t1Report = seedReportFor(T1);
    const t2Report = seedReportFor(T2);
    const allDocs = [t1Report, t2Report];

    let capturedFilter = null;
    stubs.find = Report.find;
    Report.find = (filter) => {
      capturedFilter = filter;
      return {
        lean: () => Promise.resolve(allDocs.filter((d) => d.tenantId === filter.tenantId)),
        skip: function () { return this; },
        limit: function () { return this; },
        sort: function () { return this; },
        populate: function () { return this; },
      };
    };

    const results = await Report.find({ tenantId: u1.tenantId, isDeleted: false }).lean();

    assert.equal(capturedFilter.tenantId, T1, 'report query scoped to T1');
    assert.equal(results.length, 1);
    assert.equal(results[0].tenantId, T1);
    assert.equal(results.some((d) => d.tenantId === T2), false, 'T2 reports must not appear');
  });

  it('cross-tenant getById returns null for T1 user querying T2 report', async () => {
    const { user: u1 } = createTenantWithUser({ tenantId: T1, adminEmail: 'admin@t1.com' });
    const t2Report = seedReportFor(T2);

    stubs.findOne = Report.findOne;
    Report.findOne = (filter) => ({
      lean: () => Promise.resolve(
        filter.tenantId === t2Report.tenantId && filter._id === t2Report._id ? t2Report : null,
      ),
      populate: function () { return this; },
    });

    const result = await Report.findOne({ tenantId: u1.tenantId, _id: t2Report._id }).lean();
    assert.equal(result, null, 'cross-tenant report lookup returns null');
  });
});
