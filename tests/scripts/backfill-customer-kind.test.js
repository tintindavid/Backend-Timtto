/**
 * tests/scripts/backfill-customer-kind.test.js
 * terceros-customers-providers, task 2.3. DB-free: Customer statics are stubbed.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Customer } from '../../src/models/customer.model.js';
import { backfillCustomerKind } from '../../scripts/2026-10-12-backfill-customer-kind.js';

describe('backfillCustomerKind', () => {
  afterEach(() => { delete Customer.countDocuments; delete Customer.updateMany; });

  it('dry run counts but writes nothing', async () => {
    let wrote = false;
    Customer.countDocuments = async (f) => { assert.deepEqual(f, { kind: { $exists: false } }); return 3; };
    Customer.updateMany = async () => { wrote = true; return { modifiedCount: 3 }; };
    const r = await backfillCustomerKind({ dryRun: true });
    assert.equal(r.matched, 3);
    assert.equal(r.updated, 0);
    assert.equal(r.dryRun, true);
    assert.equal(wrote, false);
  });

  it('updates documents lacking kind to customer', async () => {
    let args = null;
    Customer.countDocuments = async () => 2;
    Customer.updateMany = async (f, u) => { args = { f, u }; return { modifiedCount: 2 }; };
    const r = await backfillCustomerKind();
    assert.deepEqual(args.f, { kind: { $exists: false } });
    assert.deepEqual(args.u, { $set: { kind: 'customer' } });
    assert.equal(r.updated, 2);
  });

  it('is idempotent: a second run updates zero', async () => {
    let remaining = 2;
    Customer.countDocuments = async () => remaining;
    Customer.updateMany = async () => { const n = remaining; remaining = 0; return { modifiedCount: n }; };
    assert.equal((await backfillCustomerKind()).updated, 2);
    assert.equal((await backfillCustomerKind()).updated, 0);
  });
});
