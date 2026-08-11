/**
 * tests/utils/customerCorreosUsados.util.test.js
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Customer } from '../../src/models/customer.model.js';
import { pushCorreoUsado } from '../../src/utils/customerCorreosUsados.util.js';
import { SHEET_SIGN_CORREOUSADOS_MAX } from '../../src/constants/sheetwork.constants.js';

describe('pushCorreoUsado', () => {
  afterEach(() => {
    delete Customer.updateOne;
    delete Customer.findOne;
  });

  it('calls $addToSet with the lowercased email', async () => {
    let firstUpdate = null;
    Customer.updateOne = async (_filter, update) => { firstUpdate = update; };
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ correousados: ['a@b.com'] }) }) });
    await pushCorreoUsado('cust-1', 'tenant-a', 'FooBar@Example.COM');
    assert.deepEqual(firstUpdate.$addToSet, { correousados: 'foobar@example.com' });
  });

  it('is a no-op when customerId or email is falsy', async () => {
    let updateCalled = false;
    Customer.updateOne = async () => { updateCalled = true; };
    await pushCorreoUsado(null, 'tenant-a', 'a@b.com');
    await pushCorreoUsado('cust-1', 'tenant-a', '');
    await pushCorreoUsado('cust-1', 'tenant-a', '   ');
    assert.equal(updateCalled, false);
  });

  it('truncates via $slice when the array exceeds the soft cap', async () => {
    let calls = [];
    Customer.updateOne = async (_filter, update) => { calls.push(update); };
    // Simulate an array already at cap + 1 after $addToSet.
    Customer.findOne = () => ({
      select: () => ({
        lean: () => Promise.resolve({
          correousados: Array.from({ length: SHEET_SIGN_CORREOUSADOS_MAX + 1 }, (_, i) => `e${i}@x.com`),
        }),
      }),
    });
    await pushCorreoUsado('cust-1', 'tenant-a', 'new@x.com');
    assert.equal(calls.length, 2, 'expects an $addToSet call and a $slice trim call');
    assert.deepEqual(calls[1].$push.correousados, { $each: [], $slice: -SHEET_SIGN_CORREOUSADOS_MAX });
  });

  it('swallows errors (non-fatal for callers)', async () => {
    Customer.updateOne = async () => { throw new Error('db down'); };
    // Should not throw.
    await pushCorreoUsado('cust-1', 'tenant-a', 'a@b.com');
    assert.ok(true);
  });
});
