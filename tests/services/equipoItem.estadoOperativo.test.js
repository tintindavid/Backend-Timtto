/**
 * tests/services/equipoItem.estadoOperativo.test.js
 *
 * Unit tests for `equipoItemService._appendEstadoOperativoHistory`
 * (equipo-estado-operativo-editable-y-cronograma-excel, tasks.md 4.1).
 * DB-free — EquipoItem statics are monkey-patched (same convention as
 * tests/services/equipoItem.duplicate.test.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { equipoItemService } from '../../src/services/equipoitem.service.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const EQUIPO_ID = '507f1f77bcf86cd799439003';

function stubFindOne(doc) {
  EquipoItem.findOne = (query) => ({
    lean: () => Promise.resolve(
      (query.tenantId !== undefined && doc.tenantId !== query.tenantId) ? null : doc,
    ),
  });
}

describe('equipoItemService._appendEstadoOperativoHistory', () => {
  afterEach(() => {
    delete EquipoItem.findOne;
    delete EquipoItem.findOneAndUpdate;
  });

  it('appends a new entry on a real change', async () => {
    stubFindOne({ _id: EQUIPO_ID, tenantId: TENANT_A, EstadoOperativo: 'Operativo' });
    let capturedUpdate = null;
    EquipoItem.findOneAndUpdate = (query, update) => {
      capturedUpdate = update;
      return Promise.resolve({ _id: EQUIPO_ID, EstadoOperativo: update.$set.EstadoOperativo });
    };

    const result = await equipoItemService._appendEstadoOperativoHistory(EQUIPO_ID, 'En Reparacion', {
      source: 'manual',
      panelUser: { userId: 'user-1', firstName: 'Martin', lastName: 'Duran' },
      tenantId: TENANT_A,
    });

    assert.equal(result.EstadoOperativo, 'En Reparacion');
    assert.equal(capturedUpdate.$set.EstadoOperativo, 'En Reparacion');
    const entry = capturedUpdate.$push.estadoOperativoHistory;
    assert.equal(entry.from, 'Operativo');
    assert.equal(entry.to, 'En Reparacion');
    assert.equal(entry.source, 'manual');
    assert.equal(entry.changedByName, 'M. Duran');
    assert.equal(entry.changedBy, 'user-1');
    assert.ok(entry.at instanceof Date);
  });

  it('is a no-op when next equals the currently stored value', async () => {
    stubFindOne({ _id: EQUIPO_ID, tenantId: TENANT_A, EstadoOperativo: 'Operativo' });
    let updateCalled = false;
    EquipoItem.findOneAndUpdate = () => { updateCalled = true; return Promise.resolve({}); };

    const result = await equipoItemService._appendEstadoOperativoHistory(EQUIPO_ID, 'Operativo', {
      source: 'manual',
      tenantId: TENANT_A,
    });

    assert.equal(result.noop, true);
    assert.equal(updateCalled, false);
  });

  it('rejects a value outside the shared enum', async () => {
    stubFindOne({ _id: EQUIPO_ID, tenantId: TENANT_A, EstadoOperativo: 'Operativo' });
    await assert.rejects(
      () => equipoItemService._appendEstadoOperativoHistory(EQUIPO_ID, 'Roto', { source: 'manual', tenantId: TENANT_A }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'INVALID_ESTADO_OPERATIVO');
        return true;
      },
    );
  });

  it('emits the structured log event on a real change', async () => {
    stubFindOne({ _id: EQUIPO_ID, tenantId: TENANT_A, EstadoOperativo: 'Operativo' });
    EquipoItem.findOneAndUpdate = () => Promise.resolve({ _id: EQUIPO_ID, EstadoOperativo: 'Fuera de Servicio' });

    const { logger } = await import('../../src/config/logger.config.js');
    const originalInfo = logger.info;
    let capturedMeta = null;
    logger.info = (message, meta) => { capturedMeta = meta; };
    try {
      await equipoItemService._appendEstadoOperativoHistory(EQUIPO_ID, 'Fuera de Servicio', {
        source: 'manual',
        tenantId: TENANT_A,
      });
    } finally {
      logger.info = originalInfo;
    }

    assert.ok(capturedMeta);
    assert.equal(capturedMeta.event, 'equipoItem.estadoOperativo.changed');
    assert.equal(capturedMeta.tenantId, TENANT_A);
    assert.equal(capturedMeta.equipoId, EQUIPO_ID);
    assert.equal(capturedMeta.from, 'Operativo');
    assert.equal(capturedMeta.to, 'Fuera de Servicio');
    assert.equal(capturedMeta.source, 'manual');
  });

  it('respects tenant isolation: cross-tenant lookup returns NOT_FOUND', async () => {
    stubFindOne({ _id: EQUIPO_ID, tenantId: TENANT_A, EstadoOperativo: 'Operativo' });
    await assert.rejects(
      () => equipoItemService._appendEstadoOperativoHistory(EQUIPO_ID, 'En Reparacion', { source: 'manual', tenantId: TENANT_B }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 404);
        assert.equal(err.code, 'NOT_FOUND');
        return true;
      },
    );
  });
});
