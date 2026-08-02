/**
 * tests/integration/clientPortalReview.routes.test.js
 *
 * DB-free "integration" tests for POST/DELETE /public/client-view/:token/reports/:reportId/review
 * (change B, design D2/D3). Same monkey-patch convention as
 * tests/integration/clientPortal.routes.test.js: drive controller ->
 * service against faked req/res, mocking only Mongoose model statics.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { OT } from '../../src/models/ot.model.js';
import { Report } from '../../src/models/report.model.js';
import { clientPortalController } from '../../src/controllers/clientPortal.controller.js';

function buildRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    end() { this.ended = true; },
  };
}

/** Chainable Mongoose-query stub. */
function mockQuery(result) {
  const q = {
    select: () => q,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
  return q;
}

const REPORT_ID = '507f1f77bcf86cd799439021';
const OT_ID = '507f1f77bcf86cd799439022';
const TOKEN_ID = '507f1f77bcf86cd799439099';

describe('POST /public/client-view/:token/reports/:reportId/review — markReviewed', () => {
  afterEach(() => {
    delete Report.findOne;
    delete Report.findByIdAndUpdate;
    delete OT.findOne;
  });

  it('happy path: Cerrado report, no hojaDeTrabajo -> 200 with clientReview.reviewedAt', async () => {
    Report.findOne = () => mockQuery({ _id: REPORT_ID, estado: 'Procesado', hojaDeTrabajo: null });
    OT.findOne = () => mockQuery({ _id: OT_ID });
    const reviewedAt = new Date('2026-08-01T12:00:00.000Z');
    Report.findByIdAndUpdate = () => mockQuery({ clientReview: { reviewedAt, reviewedByTokenId: TOKEN_ID } });

    const req = { params: { reportId: REPORT_ID }, tenantId: 'tenant-1', otIds: [OT_ID], tokenId: TOKEN_ID };
    const res = buildRes();
    await clientPortalController.markReviewed(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data, { clientReview: { reviewedAt } });
  });

  it('404 for a report outside the token OTs (OT.findOne -> null)', async () => {
    Report.findOne = () => mockQuery({ _id: REPORT_ID, estado: 'Procesado', hojaDeTrabajo: null });
    OT.findOne = () => mockQuery(null);

    const req = { params: { reportId: REPORT_ID }, tenantId: 'tenant-1', otIds: [OT_ID], tokenId: TOKEN_ID };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.markReviewed(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'REPORT_NOT_FOUND');
  });

  it('404 when the report does not exist for this tenant (Report.findOne -> null)', async () => {
    Report.findOne = () => mockQuery(null);

    const req = { params: { reportId: REPORT_ID }, tenantId: 'tenant-1', otIds: [OT_ID], tokenId: TOKEN_ID };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.markReviewed(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'REPORT_NOT_FOUND');
  });

  it('409 REPORT_NOT_REVIEWABLE for a report with a non-eligible estado', async () => {
    Report.findOne = () => mockQuery({ _id: REPORT_ID, estado: 'Abierto', hojaDeTrabajo: null });
    OT.findOne = () => mockQuery({ _id: OT_ID });

    const req = { params: { reportId: REPORT_ID }, tenantId: 'tenant-1', otIds: [OT_ID], tokenId: TOKEN_ID };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.markReviewed(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'REPORT_NOT_REVIEWABLE');
  });

  it('409 REPORT_ALREADY_SIGNED when the report already has hojaDeTrabajo set', async () => {
    Report.findOne = () => mockQuery({ _id: REPORT_ID, estado: 'Procesado', hojaDeTrabajo: 'sheet-1' });
    OT.findOne = () => mockQuery({ _id: OT_ID });

    const req = { params: { reportId: REPORT_ID }, tenantId: 'tenant-1', otIds: [OT_ID], tokenId: TOKEN_ID };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.markReviewed(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'REPORT_ALREADY_SIGNED');
  });

  it('is idempotent: marking twice in a row both return 200 with the latest reviewedAt', async () => {
    Report.findOne = () => mockQuery({ _id: REPORT_ID, estado: 'Procesado', hojaDeTrabajo: null });
    OT.findOne = () => mockQuery({ _id: OT_ID });
    let call = 0;
    Report.findByIdAndUpdate = () => {
      call += 1;
      return mockQuery({ clientReview: { reviewedAt: new Date(`2026-08-0${call}T00:00:00.000Z`) } });
    };

    const req = { params: { reportId: REPORT_ID }, tenantId: 'tenant-1', otIds: [OT_ID], tokenId: TOKEN_ID };

    const res1 = buildRes();
    await clientPortalController.markReviewed(req, res1, (err) => { throw err; });
    const res2 = buildRes();
    await clientPortalController.markReviewed(req, res2, (err) => { throw err; });

    assert.equal(res1.statusCode, 200);
    assert.equal(res2.statusCode, 200);
    assert.notEqual(res1.body.data.clientReview.reviewedAt.getTime(), res2.body.data.clientReview.reviewedAt.getTime());
  });
});

describe('DELETE /public/client-view/:token/reports/:reportId/review — unmarkReviewed', () => {
  afterEach(() => {
    delete Report.findOne;
    delete Report.findByIdAndUpdate;
    delete OT.findOne;
  });

  it('happy path: eligible report, not signed -> 204', async () => {
    Report.findOne = () => mockQuery({ _id: REPORT_ID, estado: 'Procesado', hojaDeTrabajo: null });
    OT.findOne = () => mockQuery({ _id: OT_ID });
    let unsetCalled = false;
    Report.findByIdAndUpdate = (id, update) => {
      // $unset uses `''` as the value marker, which is falsy — check key presence instead.
      unsetCalled = Boolean(update.$unset) && 'clientReview' in update.$unset;
      return mockQuery({});
    };

    const req = { params: { reportId: REPORT_ID }, tenantId: 'tenant-1', otIds: [OT_ID] };
    const res = buildRes();
    await clientPortalController.unmarkReviewed(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 204);
    assert.equal(res.ended, true);
    assert.equal(unsetCalled, true);
  });

  it('409 REPORT_ALREADY_SIGNED when the report is already in a signed sheet', async () => {
    Report.findOne = () => mockQuery({ _id: REPORT_ID, estado: 'Procesado', hojaDeTrabajo: 'sheet-1' });
    OT.findOne = () => mockQuery({ _id: OT_ID });

    const req = { params: { reportId: REPORT_ID }, tenantId: 'tenant-1', otIds: [OT_ID] };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.unmarkReviewed(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'REPORT_ALREADY_SIGNED');
  });

  it('404 when the reportId is outside the token OTs', async () => {
    Report.findOne = () => mockQuery({ _id: REPORT_ID, estado: 'Procesado', hojaDeTrabajo: null });
    OT.findOne = () => mockQuery(null);

    const req = { params: { reportId: REPORT_ID }, tenantId: 'tenant-1', otIds: [OT_ID] };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.unmarkReviewed(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'REPORT_NOT_FOUND');
  });
});
