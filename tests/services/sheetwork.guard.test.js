/**
 * tests/services/sheetwork.guard.test.js
 *
 * Guard-application tests (ot-responsables-programacion-trazable, tasks.md
 * 7.7) for the sheetwork "trabajar" endpoints (design.md D3):
 *   POST /api/v1/worksheets                    -> sheetWorkService.create
 *   PUT  /api/v1/worksheets/:id                 -> sheetWorkService.update
 *   POST /api/v1/worksheets/:sheetId/sign-inplace -> sheetWorkService.signInPlace
 *   POST /api/v1/worksheets/:sheetId/close-reports -> sheetWorkService.closeReports
 *
 * Verifies: (a) user in the active roster -> succeeds, (b) user outside the
 * active roster -> 403 NOT_RESPONSIBLE with details.responsables, (c) OT
 * with no programaciones -> permissive for any user (retro-compat).
 *
 * DB-free — SheetWork/Report/OT statics are monkey-patched (same
 * convention as tests/integration/sheetworkCloseReports.routes.test.js).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { sheetWorkService } from '../../src/services/sheetwork.service.js';
import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const TENANT = 'tenant-a';
const OT_ID = '507f1f77bcf86cd799439010';
const SHEET_ID = '507f1f77bcf86cd799439030';
const USER_IN_ROSTER = '507f1f77bcf86cd799439021';
const USER_OUTSIDE_ROSTER = '507f1f77bcf86cd799439099';

function otWithRoster(userIds) {
  return {
    _id: OT_ID,
    tenantId: TENANT,
    programaciones: [
      { isActive: true, responsables: userIds.map((userId) => ({ userId, snapshotName: `Snap ${userId}` })) },
    ],
  };
}

function otWithoutProgramaciones() {
  return { _id: OT_ID, tenantId: TENANT, programaciones: [] };
}

function stubOtFindOne(ot) {
  OT.findOne = () => ({ lean: () => Promise.resolve(ot) });
}

function assertBlocked(promise, allowedUserIds) {
  return promise.then(
    () => { throw new Error('expected a 403 NOT_RESPONSIBLE rejection'); },
    (thrown) => {
      assert.ok(thrown instanceof ApiError);
      assert.equal(thrown.statusCode, 403);
      assert.equal(thrown.code, 'NOT_RESPONSIBLE');
      assert.deepEqual(thrown.details.responsables, allowedUserIds.map((userId) => ({ userId, name: `Snap ${userId}` })));
    },
  );
}

describe('sheetWorkService.create — responsibility guard', () => {
  afterEach(() => {
    delete OT.findOne; delete OT.findOneAndUpdate;
    delete SheetWork.create; delete Report.countDocuments;
  });

  it('user outside the active roster: 403 NOT_RESPONSIBLE, no sheet created', async () => {
    stubOtFindOne(otWithRoster([USER_IN_ROSTER]));
    let createCalled = false;
    SheetWork.create = async () => { createCalled = true; return {}; };

    await assertBlocked(
      sheetWorkService.create({ otId: OT_ID, reports: [] }, TENANT, { userId: USER_OUTSIDE_ROSTER }),
      [USER_IN_ROSTER],
    );
    assert.equal(createCalled, false);
  });

  it('OT with no programaciones: permissive for any user (retro-compat)', async () => {
    stubOtFindOne(otWithoutProgramaciones());
    // numeroHoja supplied explicitly so the auto-generation branch (a
    // separate OT.findOne().select().lean() chain, unrelated to the guard)
    // is skipped — keeps this test focused on guard behavior only.
    SheetWork.create = async (doc) => ({ ...doc, _id: SHEET_ID, save: async () => {} });
    Report.countDocuments = async () => 0;
    OT.findOneAndUpdate = async () => ({});

    const result = await sheetWorkService.create(
      { otId: OT_ID, reports: [], numeroHoja: 'H-0001' },
      TENANT,
      { userId: USER_OUTSIDE_ROSTER },
    );
    assert.equal(result.sheetWork._id, SHEET_ID);
  });
});

describe('sheetWorkService.update — responsibility guard', () => {
  afterEach(() => { delete OT.findOne; delete SheetWork.findOne; delete SheetWork.findOneAndUpdate; });

  it('user outside the active roster: 403 NOT_RESPONSIBLE, no mutation', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT, otId: OT_ID }) });
    stubOtFindOne(otWithRoster([USER_IN_ROSTER]));
    let updateCalled = false;
    SheetWork.findOneAndUpdate = async () => { updateCalled = true; return {}; };

    await assertBlocked(
      sheetWorkService.update(SHEET_ID, { observaciones: 'x' }, TENANT, { userId: USER_OUTSIDE_ROSTER }),
      [USER_IN_ROSTER],
    );
    assert.equal(updateCalled, false);
  });

  it('user in the active roster: guard passes, update succeeds', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT, otId: OT_ID }) });
    stubOtFindOne(otWithRoster([USER_IN_ROSTER]));
    SheetWork.findOneAndUpdate = async () => ({ _id: SHEET_ID, observaciones: 'x' });

    const result = await sheetWorkService.update(SHEET_ID, { observaciones: 'x' }, TENANT, { userId: USER_IN_ROSTER });
    assert.equal(result.observaciones, 'x');
  });
});

describe('sheetWorkService.closeReports — responsibility guard', () => {
  afterEach(() => {
    delete OT.findOne; delete SheetWork.findOne; delete Report.updateMany; delete Report.countDocuments; delete Report.find; delete OT.findOneAndUpdate;
  });

  it('user outside the active roster: 403 NOT_RESPONSIBLE, no report mutation', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT, otId: OT_ID }) });
    stubOtFindOne(otWithRoster([USER_IN_ROSTER]));
    let updateManyCalled = false;
    Report.updateMany = async () => { updateManyCalled = true; return { modifiedCount: 0 }; };

    await assertBlocked(
      sheetWorkService.closeReports(SHEET_ID, TENANT, { userId: USER_OUTSIDE_ROSTER }),
      [USER_IN_ROSTER],
    );
    assert.equal(updateManyCalled, false);
  });

  it('OT with no programaciones: permissive for any user (retro-compat)', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT, otId: OT_ID }) });
    stubOtFindOne(otWithoutProgramaciones());
    Report.updateMany = async () => ({ modifiedCount: 1 });
    Report.countDocuments = async () => 1;
    OT.findOneAndUpdate = async () => ({});
    Report.find = () => ({ select: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) });

    const result = await sheetWorkService.closeReports(SHEET_ID, TENANT, { userId: USER_OUTSIDE_ROSTER });
    assert.equal(result.modifiedCount, 1);
  });
});

describe('sheetWorkService.signInPlace — responsibility guard', () => {
  afterEach(() => { delete OT.findOne; delete SheetWork.findOne; });

  it('user outside the active roster: 403 NOT_RESPONSIBLE before touching the signature', async () => {
    // signInPlace uses a plain (non-lean) findOne to keep a savable doc.
    SheetWork.findOne = () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, estado: 'EnviadaAFirmar' });
    stubOtFindOne(otWithRoster([USER_IN_ROSTER]));

    let thrown = null;
    try {
      await sheetWorkService.signInPlace(SHEET_ID, { signature: { imagePng: 'x' } }, TENANT, USER_OUTSIDE_ROSTER);
    } catch (err) { thrown = err; }

    assert.ok(thrown instanceof ApiError);
    assert.equal(thrown.statusCode, 403);
    assert.equal(thrown.code, 'NOT_RESPONSIBLE');
  });
});
