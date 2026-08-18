/**
 * tests/scripts/migrate-ot-legacy-responsable.test.js
 *
 * Unit tests for `migrateOtLegacyResponsable()`
 * (ot-responsables-programacion-trazable, tasks.md 7.5, design.md D12).
 * DB-free — OT.find / OT.updateOne / User.findOne are monkey-patched (same
 * convention as tests/scripts/seed-notification-rule-sheet-signed.test.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { OT } from '../../src/models/ot.model.js';
import { User } from '../../src/models/user.model.js';
import { migrateOtLegacyResponsable } from '../../scripts/migrate-ot-legacy-responsable-to-programaciones.js';

const TENANT = 'tenant-a';
const OT_ID = '507f1f77bcf86cd799439010';
const RESPONSABLE_ID = '507f1f77bcf86cd799439021';

function mockFind(result) {
  return { select: () => ({ lean: () => Promise.resolve(result) }) };
}

describe('migrateOtLegacyResponsable', () => {
  afterEach(() => {
    delete OT.find;
    delete OT.updateOne;
    delete User.findOne;
  });

  it('migrates an OT with a resolvable legacy responsable', async () => {
    OT.find = () => mockFind([
      {
        _id: OT_ID,
        tenantId: TENANT,
        ResponsableId: RESPONSABLE_ID,
        FechaCreacion: new Date('2026-01-01T00:00:00.000Z'),
        Consecutivo: 'OT-000001',
      },
    ]);
    User.findOne = () => ({ lean: () => Promise.resolve({ _id: RESPONSABLE_ID, firstName: 'Martin', lastName: 'Duran' }) });
    let updateArgs = null;
    OT.updateOne = async (filter, update) => {
      updateArgs = { filter, update };
      return { modifiedCount: 1 };
    };

    const result = await migrateOtLegacyResponsable();

    assert.equal(result.migrated, 1);
    assert.equal(result.skippedNotFound, 0);
    assert.equal(updateArgs.filter._id, OT_ID);
    const entry = updateArgs.update.$push.programaciones;
    assert.equal(entry.isActive, true);
    assert.equal(entry.createdBy, null);
    assert.equal(entry.createdByName, 'migration');
    assert.deepEqual(entry.responsables, [{ userId: RESPONSABLE_ID, snapshotName: 'M. Duran' }]);
    assert.equal(entry.fechaInicio.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(entry.fechaFin.toISOString(), '2026-01-31T00:00:00.000Z');
  });

  it('skips (and counts) an OT whose legacy responsable no longer resolves to a User', async () => {
    OT.find = () => mockFind([
      { _id: OT_ID, tenantId: TENANT, ResponsableId: RESPONSABLE_ID, FechaCreacion: new Date(), Consecutivo: 'OT-000002' },
    ]);
    User.findOne = () => ({ lean: () => Promise.resolve(null) });
    let updateCalled = false;
    OT.updateOne = async () => { updateCalled = true; return { modifiedCount: 0 }; };

    const result = await migrateOtLegacyResponsable();

    assert.equal(result.migrated, 0);
    assert.equal(result.skippedNotFound, 1);
    assert.equal(updateCalled, false);
  });

  it('only queries OTs with ResponsableId != null and empty programaciones (query shape)', async () => {
    let capturedFilter = null;
    OT.find = (filter) => { capturedFilter = filter; return mockFind([]); };

    await migrateOtLegacyResponsable();

    assert.equal(capturedFilter.isDeleted, false);
    assert.deepEqual(capturedFilter.ResponsableId, { $ne: null });
    assert.ok(Array.isArray(capturedFilter.$or));
  });

  it('re-run is idempotent — updateOne re-checks programaciones is still empty and no-ops when it is not', async () => {
    OT.find = () => mockFind([
      { _id: OT_ID, tenantId: TENANT, ResponsableId: RESPONSABLE_ID, FechaCreacion: new Date(), Consecutivo: 'OT-000003' },
    ]);
    User.findOne = () => ({ lean: () => Promise.resolve({ _id: RESPONSABLE_ID, firstName: 'Martin', lastName: 'Duran' }) });
    // Simulate a concurrent write that already populated programaciones
    // between the find() and this updateOne() — modifiedCount: 0.
    OT.updateOne = async () => ({ modifiedCount: 0 });

    const result = await migrateOtLegacyResponsable();

    assert.equal(result.migrated, 0);
    assert.equal(result.skippedAlreadyMigrated, 1);
  });
});
