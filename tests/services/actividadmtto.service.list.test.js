/**
 * tests/services/actividadmtto.service.list.test.js
 *
 * Covers the search-filter bugfix from report-actividades-extra design D7 /
 * tasks.md 1.1: the previous scaffold matched `[name, description, title,
 * email]` — all fields ActividadMtto never had — so `?search=` silently
 * returned everything paginated. Real fields are Nombre and Descripcion.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ActividadMtto } from '../../src/models/actividadmtto.model.js';
import { ActividadMttoService } from '../../src/services/actividadmtto.service.js';

const svc = new ActividadMttoService();
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

describe('ActividadMttoService#list — search filter (bugfix)', () => {
  afterEach(() => {
    delete ActividadMtto.find;
    delete ActividadMtto.countDocuments;
  });

  it('builds $or on Nombre + Descripcion (real fields), not the wrong scaffold fields', async () => {
    let capturedQuery = null;
    ActividadMtto.find = (q) => { capturedQuery = q; return chainable([]); };
    ActividadMtto.countDocuments = async () => 0;

    await svc.list({}, { search: 'cal' }, TENANT);

    assert.ok(Array.isArray(capturedQuery.$or), 'query.$or must be an array');
    assert.equal(capturedQuery.$or.length, 2, 'exactly two clauses: Nombre + Descripcion');
    const keys = capturedQuery.$or.map((c) => Object.keys(c)[0]).sort();
    assert.deepEqual(keys, ['Descripcion', 'Nombre']);
    // The old scaffold's wrong keys must not appear
    assert.equal(
      capturedQuery.$or.some((c) => 'name' in c || 'description' in c || 'title' in c || 'email' in c),
      false,
      'must not match legacy scaffold field names'
    );
  });

  it('search regex is case-insensitive', async () => {
    let capturedQuery = null;
    ActividadMtto.find = (q) => { capturedQuery = q; return chainable([]); };
    ActividadMtto.countDocuments = async () => 0;

    await svc.list({}, { search: 'CALIBRACION' }, TENANT);
    const rx = capturedQuery.$or[0].Nombre;
    assert.ok(rx instanceof RegExp);
    assert.equal(rx.flags.includes('i'), true);
  });

  it('no `search` param → no $or clause on the query', async () => {
    let capturedQuery = null;
    ActividadMtto.find = (q) => { capturedQuery = q; return chainable([]); };
    ActividadMtto.countDocuments = async () => 0;

    await svc.list({}, {}, TENANT);

    assert.equal(capturedQuery.$or, undefined, 'no search → no $or clause');
    assert.equal(capturedQuery.tenantId, TENANT, 'tenant filter still applied');
  });

  it('empty result set → returns pagination metadata correctly', async () => {
    ActividadMtto.find = () => chainable([]);
    ActividadMtto.countDocuments = async () => 0;

    const out = await svc.list({}, { page: 1, limit: 10, search: 'xyzunmatchable' }, TENANT);
    assert.deepEqual(out.data, []);
    assert.equal(out.pagination.total, 0);
    assert.equal(out.pagination.pages, 0);
    assert.equal(out.pagination.hasNext, false);
    assert.equal(out.pagination.hasPrev, false);
  });
});
