/**
 * tests/services/customer.kind.exports.test.js
 * terceros-customers-providers, tasks 5.2 / 5.3: inventory and used-emails are client-only.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { inventarioExportService } from '../../src/services/inventarioExport.service.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { pushCorreoUsado } from '../../src/utils/customerCorreosUsados.util.js';

const TENANT = 'tenant-a';
const ID = '507f1f77bcf86cd799439001';

describe('inventarioExportService with a provider id', () => {
  afterEach(() => { delete EquipoItem.find; delete Tenant.findOne; delete Customer.findOne; });

  it('responds 404 when the Customer query (which excludes providers) finds nothing', async () => {
    EquipoItem.find = () => ({ populate() { return this; }, sort() { return this; }, lean: () => Promise.resolve([]) });
    Tenant.findOne = () => ({ lean: () => Promise.resolve({ tenantId: TENANT }) });
    let query = null;
    Customer.findOne = (q) => {
      query = q;
      // Emulates MongoDB honoring { kind: { $ne: 'provider' } } against a provider doc.
      const doc = { _id: ID, kind: 'provider' };
      const excluded = query.kind && query.kind.$ne === doc.kind;
      return { lean: () => Promise.resolve(excluded ? null : doc) };
    };
    await assert.rejects(() => inventarioExportService.generateExcel(ID, TENANT), (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    });
    assert.deepEqual(query.kind, { $ne: 'provider' });
  });
});

describe('pushCorreoUsado only touches clients', () => {
  afterEach(() => { delete Customer.updateOne; delete Customer.findOne; });

  it('adds the kind != provider filter to the update and the read', async () => {
    const filters = [];
    Customer.updateOne = async (f) => { filters.push(f); };
    Customer.findOne = (f) => {
      filters.push(f);
      return { select: () => ({ lean: () => Promise.resolve({ correousados: [] }) }) };
    };
    await pushCorreoUsado(ID, TENANT, 'a@b.com');
    assert.equal(filters.length, 2);
    for (const f of filters) assert.deepEqual(f.kind, { $ne: 'provider' });
  });
});
