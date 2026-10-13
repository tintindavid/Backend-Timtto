/**
 * tests/utils/assertCustomerKind.util.test.js
 * terceros-customers-providers, tasks 1.4 / 4.1. DB-free: Customer.findOne is stubbed.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Customer } from '../../src/models/customer.model.js';
import { assertCustomerKind } from '../../src/utils/assertCustomerKind.util.js';

const TENANT_A = 'tenant-a';
const ID = '507f1f77bcf86cd799439001';

// Honors the tenantId in the filter so the cross-tenant case is meaningful.
function stubFindOne(docs) {
  Customer.findOne = (query) => ({
    select() { return this; },
    lean: () => Promise.resolve(
      docs.find((d) => d.tenantId === query.tenantId && String(d._id) === String(query._id)) || null,
    ),
  });
}

describe('assertCustomerKind', () => {
  afterEach(() => { delete Customer.findOne; });

  it('accepts a client', async () => {
    stubFindOne([{ _id: ID, tenantId: TENANT_A, kind: 'customer' }]);
    const doc = await assertCustomerKind(ID, TENANT_A);
    assert.equal(doc.kind, 'customer');
  });

  it('accepts a legacy document without kind', async () => {
    stubFindOne([{ _id: ID, tenantId: TENANT_A }]);
    await assert.doesNotReject(() => assertCustomerKind(ID, TENANT_A));
  });

  it('rejects a provider with 400 INVALID_CUSTOMER_KIND', async () => {
    stubFindOne([{ _id: ID, tenantId: TENANT_A, kind: 'provider' }]);
    await assert.rejects(() => assertCustomerKind(ID, TENANT_A), (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'INVALID_CUSTOMER_KIND');
      return true;
    });
  });

  it('returns 404 when the customer belongs to another tenant', async () => {
    stubFindOne([{ _id: ID, tenantId: 'tenant-b', kind: 'customer' }]);
    await assert.rejects(() => assertCustomerKind(ID, TENANT_A), (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });

  it('returns 404 when the id does not exist or is not a valid ObjectId', async () => {
    stubFindOne([]);
    await assert.rejects(() => assertCustomerKind(ID, TENANT_A), (err) => err.statusCode === 404);
    await assert.rejects(() => assertCustomerKind('not-an-id', TENANT_A), (err) => err.statusCode === 404);
  });

  it('is a no-op when no customer id is supplied', async () => {
    let called = false;
    Customer.findOne = () => { called = true; };
    assert.equal(await assertCustomerKind(null, TENANT_A), null);
    assert.equal(await assertCustomerKind(undefined, TENANT_A), null);
    assert.equal(called, false);
  });
});
