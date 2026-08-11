/**
 * tests/services/items.service.list.test.js
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { Items } from '../../src/models/items.model.js';
import { ItemsService } from '../../src/services/items.service.js';

const svc = new ItemsService();
const TENANT = 'tenant-a';

function chainable(finalArray) {
  const c = {
    sort: () => c,
    skip: () => c,
    limit: () => c,
    lean: () => Promise.resolve(finalArray),
  };
  return c;
}

describe('ItemsService#list — search', () => {
  afterEach(() => {
    delete Items.find;
    delete Items.countDocuments;
  });

  it('builds $or on Nombre + Observacion (not the wrong scaffold fields)', async () => {
    let capturedQuery = null;
    Items.find = (q) => { capturedQuery = q; return chainable([]); };
    Items.countDocuments = async () => 0;

    await svc.list({}, { search: 'monitor' }, TENANT);

    assert.ok(Array.isArray(capturedQuery.$or));
    assert.equal(capturedQuery.$or.length, 2);
    const keys = capturedQuery.$or.map((c) => Object.keys(c)[0]).sort();
    assert.deepEqual(keys, ['Nombre', 'Observacion']);
    assert.equal(capturedQuery.$or.some((c) => 'name' in c || 'description' in c), false);
  });

  it('escapes regex metacharacters', async () => {
    let capturedQuery = null;
    Items.find = (q) => { capturedQuery = q; return chainable([]); };
    Items.countDocuments = async () => 0;

    await svc.list({}, { search: '.*' }, TENANT);
    const rx = capturedQuery.$or[0].Nombre;
    assert.equal(rx.test('anything'), false);
    assert.equal(rx.test('a.*b'), true);
  });
});
