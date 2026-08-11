/**
 * tests/services/protocolomtto.service.list.test.js
 *
 * Covers the search-regex fix: field names + regex escaping.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ProtocoloMtto } from '../../src/models/protocolomtto.model.js';
import { ProtocoloMttoService } from '../../src/services/protocolomtto.service.js';

const svc = new ProtocoloMttoService();
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

describe('ProtocoloMttoService#list — search', () => {
  afterEach(() => {
    delete ProtocoloMtto.find;
    delete ProtocoloMtto.countDocuments;
  });

  it('builds $or on nombre + Descripcion (not the wrong scaffold fields)', async () => {
    let capturedQuery = null;
    ProtocoloMtto.find = (q) => {
      capturedQuery = q;
      return chainable([]);
    };
    ProtocoloMtto.countDocuments = async () => 0;

    await svc.list({}, { search: 'preventiv' }, TENANT);

    assert.ok(Array.isArray(capturedQuery.$or), 'query.$or must be an array');
    assert.equal(capturedQuery.$or.length, 2, 'exactly two clauses: nombre + Descripcion');
    const keys = capturedQuery.$or.map((c) => Object.keys(c)[0]).sort();
    assert.deepEqual(keys, ['Descripcion', 'nombre']);
    // The scaffold's wrong keys must not appear
    assert.equal(capturedQuery.$or.some((c) => 'name' in c || 'title' in c || 'email' in c), false);
  });

  it('escapes regex metacharacters so `.*` is a literal search', async () => {
    let capturedQuery = null;
    ProtocoloMtto.find = (q) => {
      capturedQuery = q;
      return chainable([]);
    };
    ProtocoloMtto.countDocuments = async () => 0;

    await svc.list({}, { search: '.*' }, TENANT);

    const rx = capturedQuery.$or[0].nombre;
    assert.ok(rx instanceof RegExp);
    // Escaped `.` and `*` mean the regex only matches strings that CONTAIN
    // the literal `.*` substring, not everything.
    assert.equal(rx.test('anything'), false);
    assert.equal(rx.test('a.*b'), true);
  });

  it('is case-insensitive', async () => {
    let capturedQuery = null;
    ProtocoloMtto.find = (q) => {
      capturedQuery = q;
      return chainable([]);
    };
    ProtocoloMtto.countDocuments = async () => 0;

    await svc.list({}, { search: 'MONITOR' }, TENANT);
    const rx = capturedQuery.$or[0].nombre;
    assert.equal(rx.flags.includes('i'), true);
  });
});
