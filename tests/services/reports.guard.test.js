/**
 * tests/services/reports.guard.test.js
 *
 * Guard-application tests (ot-responsables-programacion-trazable, tasks.md
 * 7.7) for reportService.procesar / reportService.unprocess — the two
 * canonical "trabajar" endpoints on reports (design.md D3):
 *   PUT /api/v1/reports/:reporteId/procesar
 *   PUT /api/v1/reports/:reporteId/unprocess
 *
 * Verifies: (a) user in the active roster -> succeeds, (b) user outside the
 * active roster -> 403 NOT_RESPONSIBLE with details.responsables, (c) OT
 * with no programaciones -> permissive for any user (retro-compat).
 *
 * DB-free — Report/OT/EquipoItem statics are monkey-patched (same
 * convention as tests/ot.completion-sync.test.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { reportService } from '../../src/services/report.service.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { History } from '../../src/models/history.model.js';
import { ApiError } from '../../src/utils/apiError.util.js';

// historyService.record() is best-effort (swallows failures) but a real,
// un-mocked History.create() call buffers against a non-existent Mongo
// connection and only rejects after the ~10s bufferTimeoutMS default —
// stubbing it keeps these guard-focused tests fast and deterministic.
History.create = async () => ({});

const TENANT = 'tenant-a';
const REPORT_ID = '507f1f77bcf86cd799439040';
const OT_ID = '507f1f77bcf86cd799439010';
const USER_IN_ROSTER = '507f1f77bcf86cd799439021';
const USER_OUTSIDE_ROSTER = '507f1f77bcf86cd799439099';

function otWithRoster(userIds) {
  return {
    _id: OT_ID,
    tenantId: TENANT,
    programaciones: [
      {
        isActive: true,
        responsables: userIds.map((userId) => ({ userId, snapshotName: `Snap ${userId}` })),
      },
    ],
  };
}

function otWithoutProgramaciones() {
  return { _id: OT_ID, tenantId: TENANT, programaciones: [] };
}

function stubReportFindOne(previous) {
  Report.findOne = () => ({ lean: () => Promise.resolve(previous) });
}

function stubOtFindOne(ot) {
  OT.findOne = () => ({ lean: () => Promise.resolve(ot) });
}

function stubCommonPostGuard() {
  // Report.findOneAndUpdate returns a report with no `Equipo` field so the
  // EquipoItem-recompute branch is skipped entirely, and `orden` present so
  // the OT-progress-recompute branch runs against harmless mocks.
  Report.findOneAndUpdate = async () => ({ _id: REPORT_ID, orden: OT_ID, estado: 'Procesado', consecutivo: 'R-000001' });
  Report.countDocuments = async () => 1;
  OT.findOneAndUpdate = async () => ({});
  EquipoItem.findOne = () => ({ lean: () => Promise.resolve(null) });
}

describe('reportService.procesar — responsibility guard', () => {
  afterEach(() => {
    delete Report.findOne;
    delete Report.findOneAndUpdate;
    delete Report.countDocuments;
    delete OT.findOne;
    delete OT.findOneAndUpdate;
    delete EquipoItem.findOne;
  });

  it('user in the active roster: guard passes, procesar succeeds', async () => {
    stubReportFindOne({ _id: REPORT_ID, tenantId: TENANT, orden: OT_ID, estado: 'Pendiente' });
    stubOtFindOne(otWithRoster([USER_IN_ROSTER]));
    stubCommonPostGuard();

    const result = await reportService.procesar(REPORT_ID, { estado: 'Procesado' }, TENANT, { userId: USER_IN_ROSTER });
    assert.equal(result.report.estado, 'Procesado');
  });

  it('user outside the active roster: 403 NOT_RESPONSIBLE with details.responsables, no mutation', async () => {
    stubReportFindOne({ _id: REPORT_ID, tenantId: TENANT, orden: OT_ID, estado: 'Pendiente' });
    stubOtFindOne(otWithRoster([USER_IN_ROSTER]));
    let mutationCalled = false;
    Report.findOneAndUpdate = async () => { mutationCalled = true; return {}; };

    let thrown = null;
    try {
      await reportService.procesar(REPORT_ID, { estado: 'Procesado' }, TENANT, { userId: USER_OUTSIDE_ROSTER });
    } catch (err) { thrown = err; }

    assert.ok(thrown instanceof ApiError);
    assert.equal(thrown.statusCode, 403);
    assert.equal(thrown.code, 'NOT_RESPONSIBLE');
    assert.deepEqual(thrown.details.responsables, [{ userId: USER_IN_ROSTER, name: `Snap ${USER_IN_ROSTER}` }]);
    assert.equal(mutationCalled, false, 'Report.findOneAndUpdate must not run when the guard blocks');
  });

  it('OT with no programaciones: permissive for any user (retro-compat)', async () => {
    stubReportFindOne({ _id: REPORT_ID, tenantId: TENANT, orden: OT_ID, estado: 'Pendiente' });
    stubOtFindOne(otWithoutProgramaciones());
    stubCommonPostGuard();

    const result = await reportService.procesar(REPORT_ID, { estado: 'Procesado' }, TENANT, { userId: USER_OUTSIDE_ROSTER });
    assert.equal(result.report.estado, 'Procesado');
  });
});

describe('reportService.unprocess — responsibility guard', () => {
  afterEach(() => {
    delete Report.findOne;
    delete Report.findOneAndUpdate;
    delete Report.countDocuments;
    delete OT.findOne;
    delete OT.findOneAndUpdate;
  });

  function stubUnprocessSuccess() {
    Report.findOneAndUpdate = async () => ({ _id: REPORT_ID, orden: OT_ID, estado: 'Pendiente', consecutivo: 'R-000001' });
    Report.countDocuments = async () => 0;
    OT.findOneAndUpdate = async () => ({});
  }

  it('user in the active roster: guard passes, unprocess succeeds', async () => {
    stubReportFindOne({ _id: REPORT_ID, tenantId: TENANT, orden: OT_ID, estado: 'Procesado' });
    stubOtFindOne(otWithRoster([USER_IN_ROSTER]));
    stubUnprocessSuccess();

    const result = await reportService.unprocess(REPORT_ID, TENANT, { userId: USER_IN_ROSTER });
    assert.equal(result.estado, 'Pendiente');
  });

  it('user outside the active roster: 403 NOT_RESPONSIBLE, no mutation', async () => {
    stubReportFindOne({ _id: REPORT_ID, tenantId: TENANT, orden: OT_ID, estado: 'Procesado' });
    stubOtFindOne(otWithRoster([USER_IN_ROSTER]));
    let mutationCalled = false;
    Report.findOneAndUpdate = async () => { mutationCalled = true; return {}; };

    let thrown = null;
    try {
      await reportService.unprocess(REPORT_ID, TENANT, { userId: USER_OUTSIDE_ROSTER });
    } catch (err) { thrown = err; }

    assert.ok(thrown instanceof ApiError);
    assert.equal(thrown.statusCode, 403);
    assert.equal(thrown.code, 'NOT_RESPONSIBLE');
    assert.equal(mutationCalled, false);
  });

  it('OT with no programaciones: permissive for any user (retro-compat)', async () => {
    stubReportFindOne({ _id: REPORT_ID, tenantId: TENANT, orden: OT_ID, estado: 'Procesado' });
    stubOtFindOne(otWithoutProgramaciones());
    stubUnprocessSuccess();

    const result = await reportService.unprocess(REPORT_ID, TENANT, { userId: USER_OUTSIDE_ROSTER });
    assert.equal(result.estado, 'Pendiente');
  });
});
