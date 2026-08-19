/**
 * tests/services/equipoItem.duplicate.test.js
 *
 * Guard-application tests for equipo-duplicate-detection-and-replace
 * (tasks.md 6.2/6.3/6.4). DB-free — EquipoItem statics are monkey-patched
 * (same convention as tests/services/reports.guard.test.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { equipoItemService } from '../../src/services/equipoitem.service.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const CLIENTE_ID = '507f1f77bcf86cd799439001';
const ITEM_ID = '507f1f77bcf86cd799439002';
const EQUIPO_ID = '507f1f77bcf86cd799439003';
const OTHER_EQUIPO_ID = '507f1f77bcf86cd799439004';

function existingDoc(overrides = {}) {
  return {
    _id: OTHER_EQUIPO_ID,
    tenantId: TENANT_A,
    ClienteId: CLIENTE_ID,
    ItemId: ITEM_ID,
    Marca: 'Philips',
    Serie: 'A123',
    SerieNormalized: 'A123',
    ...overrides,
  };
}

// Chainable EquipoItem.findOne stub: honors the query's tenantId and
// excludeId ($ne) filters so tenant-isolation / self-edit-skip tests are
// meaningful, not just "return whatever the test says".
function stubFindOne(docs) {
  EquipoItem.findOne = (query) => ({
    collation() { return this; },
    populate() { return this; },
    lean: () => Promise.resolve(
      docs.find((d) => {
        if (query.tenantId !== undefined && d.tenantId !== query.tenantId) return false;
        if (query._id && query._id.$ne && String(d._id) === String(query._id.$ne)) return false;
        return d.ClienteId === query.ClienteId
          && d.ItemId === query.ItemId
          && d.Marca.toUpperCase() === query.Marca
          && d.SerieNormalized === query.SerieNormalized;
      }) || null,
    ),
  });
}

describe('equipoItemService.checkDuplicate', () => {
  afterEach(() => { delete EquipoItem.findOne; });

  it('placeholder (non-digit-bearing) serial: no conflict, no DB match needed', async () => {
    stubFindOne([existingDoc({ Serie: 'No tiene', SerieNormalized: null })]);
    const result = await equipoItemService.checkDuplicate(
      { ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'No tiene' },
      TENANT_A,
    );
    assert.equal(result.conflict, false);
  });

  it('digit-bearing serial matching an existing row: conflict with populated existing', async () => {
    stubFindOne([existingDoc()]);
    const result = await equipoItemService.checkDuplicate(
      { ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'PHILIPS', Serie: ' a123 ' },
      TENANT_A,
    );
    assert.equal(result.conflict, true);
    assert.equal(result.existing._id, OTHER_EQUIPO_ID);
  });

  it('excludeId skips the row being edited (self-edit is not a conflict)', async () => {
    stubFindOne([existingDoc({ _id: EQUIPO_ID })]);
    const result = await equipoItemService.checkDuplicate(
      { ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A123', excludeId: EQUIPO_ID },
      TENANT_A,
    );
    assert.equal(result.conflict, false);
  });

  it('cross-tenant isolation: same tuple in another tenant is not surfaced', async () => {
    stubFindOne([existingDoc({ tenantId: TENANT_A })]);
    const result = await equipoItemService.checkDuplicate(
      { ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A123' },
      TENANT_B,
    );
    assert.equal(result.conflict, false);
  });

  it('missing ItemId: no conflict regardless of matching rows', async () => {
    stubFindOne([existingDoc()]);
    const result = await equipoItemService.checkDuplicate(
      { ClienteId: CLIENTE_ID, Marca: 'Philips', Serie: 'A123' },
      TENANT_A,
    );
    assert.equal(result.conflict, false);
  });
});

describe('equipoItemService.checkDuplicateBulk', () => {
  afterEach(() => { delete EquipoItem.findOne; });

  it('caps at 500 items', async () => {
    const items = Array.from({ length: 501 }, (_, i) => ({
      rowId: `row-${i}`, ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: `S${i}`,
    }));
    await assert.rejects(
      () => equipoItemService.checkDuplicateBulk(items, TENANT_A),
      (err) => err instanceof ApiError && err.statusCode === 400 && err.code === 'BULK_LIMIT_EXCEEDED',
    );
  });

  it('returns a per-row conflict map', async () => {
    stubFindOne([existingDoc()]);
    const items = [
      { rowId: 'r1', ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A123' },
      { rowId: 'r2', ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'Z999' },
      { rowId: 'r3', ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'No tiene' },
    ];
    const results = await equipoItemService.checkDuplicateBulk(items, TENANT_A);
    assert.equal(Object.keys(results).length, 3);
    assert.equal(results.r1.conflict, true);
    assert.equal(results.r2.conflict, false);
    assert.equal(results.r3.conflict, false);
  });
});

describe('equipoItemService.create — duplicate guard', () => {
  afterEach(() => { delete EquipoItem.findOne; delete EquipoItem.create; });

  it('throws 409 EQUIPO_DUPLICATE when the tuple already exists', async () => {
    stubFindOne([existingDoc()]);
    let createCalled = false;
    EquipoItem.create = async () => { createCalled = true; return {}; };

    await assert.rejects(
      () => equipoItemService.create({ ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A123' }, TENANT_A),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'EQUIPO_DUPLICATE');
        assert.equal(err.details.existing._id, OTHER_EQUIPO_ID);
        return true;
      },
    );
    assert.equal(createCalled, false, 'insert must not run when the guard blocks');
  });

  it('translates a concurrent E11000 insert error into the same 409 shape', async () => {
    // Guard's own findOne sees no conflict (simulating the race window)...
    let findOneCallCount = 0;
    EquipoItem.findOne = (query) => ({
      collation() { return this; },
      populate() { return this; },
      lean: () => {
        findOneCallCount += 1;
        // First call (pre-insert guard): no conflict. Second call
        // (post-E11000 re-fetch): the concurrent winner is now visible.
        return Promise.resolve(findOneCallCount === 1 ? null : existingDoc());
      },
    });
    EquipoItem.create = async () => {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      throw err;
    };

    await assert.rejects(
      () => equipoItemService.create({ ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A123' }, TENANT_A),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'EQUIPO_DUPLICATE');
        assert.equal(err.details.existing._id, OTHER_EQUIPO_ID);
        return true;
      },
    );
    assert.equal(findOneCallCount, 2);
  });
});

describe('equipoItemService.update — duplicate guard', () => {
  afterEach(() => { delete EquipoItem.findOne; delete EquipoItem.findById; delete EquipoItem.findByIdAndUpdate; });

  it('editing into a conflicting tuple is rejected with 409', async () => {
    EquipoItem.findById = () => ({ lean: () => Promise.resolve({ _id: EQUIPO_ID, tenantId: TENANT_A, ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A999' }) });
    stubFindOne([existingDoc({ _id: OTHER_EQUIPO_ID })]);
    let updateCalled = false;
    EquipoItem.findByIdAndUpdate = async () => { updateCalled = true; return {}; };

    await assert.rejects(
      () => equipoItemService.update(EQUIPO_ID, { Serie: 'A123' }, TENANT_A),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'EQUIPO_DUPLICATE');
        return true;
      },
    );
    assert.equal(updateCalled, false);
  });

  it('editing a field outside the tuple does not run the guard', async () => {
    EquipoItem.findByIdAndUpdate = async () => ({ _id: EQUIPO_ID, Ubicacion: 'Piso 3' });
    let findByIdCalled = false;
    EquipoItem.findById = () => { findByIdCalled = true; return { lean: () => Promise.resolve(null) }; };

    const result = await equipoItemService.update(EQUIPO_ID, { Ubicacion: 'Piso 3' }, TENANT_A);
    assert.equal(result.Ubicacion, 'Piso 3');
    assert.equal(findByIdCalled, false, 'guard lookup must not run when the tuple fields are untouched');
  });
});

describe('equipoItemService.updateAndSnapshot — duplicate guard', () => {
  afterEach(() => { delete EquipoItem.findOne; delete EquipoItem.findById; delete EquipoItem.findByIdAndUpdate; });

  it('a conflicting field change is rejected with 409', async () => {
    EquipoItem.findById = () => ({ lean: () => Promise.resolve({ _id: EQUIPO_ID, tenantId: TENANT_A, ClienteId: CLIENTE_ID, ItemId: ITEM_ID, Marca: 'Philips', Serie: 'A999' }) });
    stubFindOne([existingDoc({ _id: OTHER_EQUIPO_ID })]);
    let updateCalled = false;
    EquipoItem.findByIdAndUpdate = () => { updateCalled = true; return { populate() { return this; }, lean: () => Promise.resolve({}) }; };

    await assert.rejects(
      () => equipoItemService.updateAndSnapshot(EQUIPO_ID, { Serie: 'A123' }, TENANT_A),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'EQUIPO_DUPLICATE');
        return true;
      },
    );
    assert.equal(updateCalled, false);
  });
});
