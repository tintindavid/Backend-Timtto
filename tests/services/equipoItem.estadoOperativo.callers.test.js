/**
 * tests/services/equipoItem.estadoOperativo.callers.test.js
 *
 * Verifies every call site that mutates `EstadoOperativo` routes through
 * `equipoItemService._appendEstadoOperativoHistory` instead of writing the
 * field directly (equipo-estado-operativo-editable-y-cronograma-excel,
 * tasks.md 4.2-4.5). DB-free — statics are monkey-patched (same convention
 * as tests/services/equipoItem.duplicate.test.js and
 * tests/services/reports.guard.test.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { equipoItemService } from '../../src/services/equipoitem.service.js';
import { reportService } from '../../src/services/report.service.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { History } from '../../src/models/history.model.js';

// historyService.record() is best-effort but a real, un-mocked
// History.create() call buffers against a non-existent Mongo connection —
// stub it so these tests stay fast and deterministic (same as
// tests/services/reports.guard.test.js).
History.create = async () => ({});

const TENANT = 'tenant-a';
const EQUIPO_ID = '507f1f77bcf86cd799439003';
const REPORT_ID = '507f1f77bcf86cd799439040';

describe('equipoItemService.create — EstadoOperativo history seeding', () => {
  afterEach(() => {
    delete EquipoItem.findOne;
    delete EquipoItem.create;
    delete EquipoItem.findOneAndUpdate;
  });

  it('seeds an initial history entry when EstadoOperativo is explicitly supplied', async () => {
    EquipoItem.create = async (data) => ({ _id: EQUIPO_ID, ...data });
    EquipoItem.findOne = () => ({ lean: () => Promise.resolve({ _id: EQUIPO_ID, tenantId: TENANT, EstadoOperativo: 'En Reparacion' }) });
    let pushedEntry = null;
    EquipoItem.findOneAndUpdate = (query, update) => {
      pushedEntry = update.$push.estadoOperativoHistory;
      return Promise.resolve({ _id: EQUIPO_ID, EstadoOperativo: update.$set.EstadoOperativo });
    };

    const entity = await equipoItemService.create(
      { ClienteId: 'c1', Marca: 'Philips', Serie: 'A123', EstadoOperativo: 'En Reparacion' },
      TENANT,
    );

    assert.equal(entity._id, EQUIPO_ID);
    assert.ok(pushedEntry, 'history entry must have been pushed');
    assert.equal(pushedEntry.from, null);
    assert.equal(pushedEntry.to, 'En Reparacion');
    assert.equal(pushedEntry.source, 'manual');
  });

  it('skips history seeding when EstadoOperativo is not supplied', async () => {
    EquipoItem.create = async (data) => ({ _id: EQUIPO_ID, ...data });
    let updateCalled = false;
    EquipoItem.findOneAndUpdate = () => { updateCalled = true; return Promise.resolve({}); };

    await equipoItemService.create({ ClienteId: 'c1', Marca: 'Philips', Serie: 'A123' }, TENANT);

    assert.equal(updateCalled, false);
  });

  it('threads options.source through to the seeded entry (bulk-upload path)', async () => {
    EquipoItem.create = async (data) => ({ _id: EQUIPO_ID, ...data });
    EquipoItem.findOne = () => ({ lean: () => Promise.resolve({ _id: EQUIPO_ID, tenantId: TENANT, EstadoOperativo: 'Operativo' }) });
    let pushedEntry = null;
    EquipoItem.findOneAndUpdate = (query, update) => {
      pushedEntry = update.$push.estadoOperativoHistory;
      return Promise.resolve({ _id: EQUIPO_ID, EstadoOperativo: update.$set.EstadoOperativo });
    };

    await equipoItemService.create(
      { ClienteId: 'c1', Marca: 'Philips', Serie: 'A123', EstadoOperativo: 'Operativo' },
      TENANT,
      null,
      { source: 'bulk-upload' },
    );

    assert.equal(pushedEntry.source, 'bulk-upload');
  });
});

describe('equipoItemService.update — EstadoOperativo + motivo', () => {
  afterEach(() => {
    delete EquipoItem.findOne;
    delete EquipoItem.findById;
    delete EquipoItem.findByIdAndUpdate;
    delete EquipoItem.findOneAndUpdate;
  });

  it('routes EstadoOperativo + estadoOperativoMotivo through the helper', async () => {
    EquipoItem.findOne = () => ({ lean: () => Promise.resolve({ _id: EQUIPO_ID, tenantId: TENANT, EstadoOperativo: 'Operativo' }) });
    let pushedEntry = null;
    let genericSet = null;
    EquipoItem.findByIdAndUpdate = (id, update) => {
      genericSet = update.$set;
      return Promise.resolve({ _id: EQUIPO_ID, ...update.$set });
    };
    // The helper itself calls EquipoItem.findOneAndUpdate (atomic push+set) —
    // route it separately from the generic findByIdAndUpdate above.
    EquipoItem.findOneAndUpdate = (query, update) => {
      pushedEntry = update.$push.estadoOperativoHistory;
      return Promise.resolve({ _id: EQUIPO_ID, EstadoOperativo: update.$set.EstadoOperativo });
    };

    await equipoItemService.update(
      EQUIPO_ID,
      { EstadoOperativo: 'Fuera de Servicio', estadoOperativoMotivo: 'Falla eléctrica', Ubicacion: 'Piso 2' },
      TENANT,
      { userId: 'u1', firstName: 'Martin', lastName: 'Duran' },
    );

    assert.ok(pushedEntry, 'history entry must have been pushed');
    assert.equal(pushedEntry.to, 'Fuera de Servicio');
    assert.equal(pushedEntry.motivo, 'Falla eléctrica');
    assert.equal(pushedEntry.changedByName, 'M. Duran');
    // The generic $set must never include EstadoOperativo/estadoOperativoMotivo
    assert.equal(typeof genericSet.EstadoOperativo, 'undefined');
    assert.equal(typeof genericSet.estadoOperativoMotivo, 'undefined');
    assert.equal(genericSet.Ubicacion, 'Piso 2');
  });
});

describe('equipoItemService.updateAndSnapshot — EstadoOperativo', () => {
  afterEach(() => {
    delete EquipoItem.findOne;
    delete EquipoItem.findById;
    delete EquipoItem.findByIdAndUpdate;
    delete EquipoItem.findOneAndUpdate;
    delete Report.findOneAndUpdate;
  });

  it('routes EstadoOperativo through the helper and keeps other fields in the snapshot update', async () => {
    EquipoItem.findOne = () => ({ lean: () => Promise.resolve({ _id: EQUIPO_ID, tenantId: TENANT, EstadoOperativo: 'Operativo' }) });
    let pushedEntry = null;
    EquipoItem.findOneAndUpdate = (query, update) => {
      pushedEntry = update.$push.estadoOperativoHistory;
      return Promise.resolve({ _id: EQUIPO_ID, EstadoOperativo: update.$set.EstadoOperativo });
    };
    EquipoItem.findByIdAndUpdate = () => ({
      populate() { return this; },
      lean: () => Promise.resolve({ _id: EQUIPO_ID, Marca: 'Philips', Ubicacion: 'Piso 3' }),
    });

    const result = await equipoItemService.updateAndSnapshot(
      EQUIPO_ID,
      { EstadoOperativo: 'En Mantenimiento', Ubicacion: 'Piso 3' },
      TENANT,
      { userId: 'u1' },
    );

    assert.ok(pushedEntry, 'history entry must have been pushed');
    assert.equal(pushedEntry.to, 'En Mantenimiento');
    assert.equal(result.equipo.Ubicacion, 'Piso 3');
  });
});

describe('report.service.js#procesar — EstadoOperativo history on report close', () => {
  afterEach(() => {
    delete Report.findOne;
    delete Report.findOneAndUpdate;
    delete Report.countDocuments;
    delete OT.findOne;
    delete OT.findOneAndUpdate;
    delete EquipoItem.findOne;
    delete EquipoItem.findOneAndUpdate;
  });

  it('produces a history entry with source=report-close and the closing reportId', async () => {
    Report.findOne = () => ({ lean: () => Promise.resolve({ _id: REPORT_ID, tenantId: TENANT, estado: 'Pendiente', orden: null }) });
    Report.findOneAndUpdate = async () => ({ _id: REPORT_ID, Equipo: EQUIPO_ID, estado: 'Cerrado', consecutivo: 'R-000001' });
    Report.countDocuments = async () => 0;

    let pushedEntry = null;
    let capturedTenant = null;
    EquipoItem.findOne = () => ({ lean: () => Promise.resolve({ _id: EQUIPO_ID, tenantId: TENANT, EstadoOperativo: 'Operativo', mesesMtto: [] }) });
    EquipoItem.findOneAndUpdate = (query, update) => {
      if (update.$push) {
        pushedEntry = update.$push.estadoOperativoHistory;
        capturedTenant = query.tenantId;
        return Promise.resolve({ _id: EQUIPO_ID, EstadoOperativo: update.$set.EstadoOperativo });
      }
      // Second call: mesesMttoRealizados/UltimoMtto generic $set.
      return Promise.resolve({ _id: EQUIPO_ID });
    };

    const result = await reportService.procesar(
      REPORT_ID,
      { estado: 'Cerrado', estadoOperativo: 'Fuera de Servicio' },
      TENANT,
      { userId: 'u1' },
    );

    assert.equal(result.report.estado, 'Cerrado');
    assert.ok(pushedEntry, 'history entry must have been pushed');
    assert.equal(pushedEntry.to, 'Fuera de Servicio');
    assert.equal(pushedEntry.source, 'report-close');
    assert.equal(pushedEntry.reportId, REPORT_ID);
    assert.equal(capturedTenant, TENANT);
  });
});
