/**
 * tests/integration/clientPortalSign.routes.test.js
 *
 * DB-free "integration" tests for POST /public/client-view/:token/sign
 * (change B, design D6/D9). Mocks every Mongoose model static + the
 * Firebase upload boundary, drives controller -> service directly.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { clientPortalController } from '../../src/controllers/clientPortal.controller.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';

function buildRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
  };
}

/** Query stub supporting only `.select()`/`.lean()` (used by OT.find, Report.find). */
function mockQuery(result) {
  const q = {
    select: () => q,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
  return q;
}

/** Query stub supporting `.populate()` then awaited directly (ClientAccessToken.findById). */
function mockPopulateQuery(result) {
  const q = {
    populate: () => q,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
  return q;
}

const TOKEN_ID = '507f1f77bcf86cd799439001';
const CREATOR_ID = '507f1f77bcf86cd799439002';
const OT_A_ID = '507f1f77bcf86cd799439010';
const OT_B_ID = '507f1f77bcf86cd799439011';
const R1 = '507f1f77bcf86cd799439021';
const R2 = '507f1f77bcf86cd799439022';
const R3 = '507f1f77bcf86cd799439023';

// A minimal but valid PNG signature: 8-byte magic header padded to satisfy
// the DTO's decoded-size/base64 rules; the DTO itself is pre-validated by
// Backend #1 and out of scope here — the sign() controller receives
// req.body already shaped, so tests call the controller directly (bypassing
// the `validate` middleware) with a plain object body.
const VALID_SIGNATURE_BASE64 = Buffer.from(
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)])
).toString('base64');

function activeCreator(overrides = {}) {
  return {
    _id: CREATOR_ID,
    fullName: 'Juan Técnico',
    role: 'admin',
    fileFirma: 'https://cdn/firma-tecnico.png',
    isDeleted: false,
    ...overrides,
  };
}

function reviewedReport(id, otId) {
  return {
    _id: id,
    tenantId: 'tenant-1',
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    clientReview: { reviewedAt: new Date('2026-08-01T00:00:00.000Z') },
  };
}

describe('POST /public/client-view/:token/sign', () => {
  afterEach(() => {
    delete ClientAccessToken.findById;
    delete Report.find;
    delete OT.find;
    delete SheetWork.insertMany;
    delete SheetWork.deleteMany;
    delete Report.updateMany;
    delete Report.bulkWrite;
    delete firebaseStorageService.uploadEvidencia;
    delete SheetWork.find;
    delete Counter.findOneAndUpdate;
  });

  it('happy path across 2 OTs: creates 2 sheets, shared signedBatchId + contentHash, source=client-portal, 202', async () => {
    ClientAccessToken.findById = () => mockPopulateQuery({ createdBy: activeCreator() });
    Report.find = () => mockQuery([reviewedReport(R1), reviewedReport(R2), reviewedReport(R3)]);
    OT.find = () => mockQuery([
      { _id: OT_A_ID, Consecutivo: 'OT-A', ClienteId: 'cliente-1', reportes: [R1, R2] },
      { _id: OT_B_ID, Consecutivo: 'OT-B', ClienteId: 'cliente-1', reportes: [R3] },
    ]);
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma.png', storagePath: 'x' });
    let seq = 0;
    Counter.findOneAndUpdate = () => ({ lean: () => Promise.resolve({ seq: (seq += 1) }) });

    let insertManyDocs = null;
    SheetWork.insertMany = async (docs) => {
      insertManyDocs = docs;
      return docs.map((d, i) => ({ ...d, _id: `sheet-${i + 1}` }));
    };
    // Claim phase now uses bulkWrite (design D6 revised — one op per OT group,
    // matchedCount summed across ops). Return the full expected match count so
    // the happy path proceeds without rollback.
    let bulkWriteOps = null;
    Report.bulkWrite = async (ops) => {
      bulkWriteOps = ops;
      const totalIds = ops.reduce((n, op) => n + op.updateMany.filter._id.$in.length, 0);
      return { matchedCount: totalIds, modifiedCount: totalIds };
    };
    // Step 10b bumps `estado: 'Procesado'` in a separate updateMany — mock it
    // as a noop success so the happy path completes.
    const updateManyCalls = [];
    Report.updateMany = async (filter, update) => {
      updateManyCalls.push({ filter, update });
      return { matchedCount: filter._id.$in.length, modifiedCount: filter._id.$in.length };
    };
    let deleteManyCalled = false;
    SheetWork.deleteMany = async () => { deleteManyCalled = true; return { deletedCount: 0 }; };
    // generatePdfsForBatch runs fire-and-forget after commit (design D8) — stub
    // SheetWork.find so the background job resolves instantly with no work.
    SheetWork.find = () => mockQuery([]);

    const req = {
      tenantId: 'tenant-1',
      tokenId: TOKEN_ID,
      otIds: [OT_A_ID, OT_B_ID],
      ip: '10.0.0.1',
      headers: { 'user-agent': 'jest-agent' },
      body: {
        reportIds: [R1, R2, R3],
        signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Test', signerId: '12345', cargo: 'Gerente' },
      },
    };
    const res = buildRes();
    await clientPortalController.sign(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.data.signedBatchId, 'string');
    assert.equal(res.body.data.sheetIds.length, 2);
    assert.equal(res.body.data.pdfStatus, 'pending');
    assert.equal(deleteManyCalled, false, 'no rollback expected on the happy path');

    assert.equal(insertManyDocs.length, 2);
    const [docA, docB] = insertManyDocs;
    assert.equal(docA.source, 'client-portal');
    assert.equal(docB.source, 'client-portal');
    assert.equal(docA.clientSignature.signedBatchId, docB.clientSignature.signedBatchId);
    assert.equal(docA.clientSignature.contentHash, docB.clientSignature.contentHash);
    assert.equal(docA.clientSignature.tokenId, TOKEN_ID);
    assert.equal(docA.firmaFile, 'https://cdn/firma.png');
    assert.equal(docA.firmaResponsableFile, 'https://cdn/firma-tecnico.png');
    assert.equal(docA.responsable, CREATOR_ID);
    assert.equal(docA.estado, 'Firmada');
    assert.equal(docA.pdfStatus, 'pending');

    // bulkWrite carries 2 per-OT-group ops; the separate estado bump is 1 updateMany call.
    assert.equal(bulkWriteOps.length, 2);
    assert.equal(updateManyCalls.length, 1, 'exactly 1 estado bump (bulk claim is via bulkWrite)');
    // Estado bump uses an aggregation-pipeline update (2026-08-02) so it can
    // also stamp `fechaFinalizdo` conditionally via $ifNull without
    // clobbering a date the technician already set.
    assert.ok(Array.isArray(updateManyCalls[0].update), 'estado bump must be a pipeline update');
    assert.equal(updateManyCalls[0].update[0].$set.estado, 'Procesado');
    assert.ok(
      updateManyCalls[0].update[0].$set.fechaFinalizdo?.$ifNull,
      'fechaFinalizdo must be set via $ifNull so existing dates survive'
    );
  });

  it('400 SIGN_REQUIRES_REVIEW when a report has no clientReview.reviewedAt', async () => {
    ClientAccessToken.findById = () => mockPopulateQuery({ createdBy: activeCreator() });
    Report.find = () => mockQuery([
      reviewedReport(R1),
      { _id: R2, tenantId: 'tenant-1', updatedAt: new Date(), clientReview: null },
    ]);

    const req = {
      tenantId: 'tenant-1',
      tokenId: TOKEN_ID,
      otIds: [OT_A_ID],
      headers: {},
      body: {
        reportIds: [R1, R2],
        signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Test', signerId: '12345' },
      },
    };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.sign(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'SIGN_REQUIRES_REVIEW');
    assert.deepEqual(capturedErr.details.unreviewedReportIds, [R2]);
  });

  it('409 TOKEN_CREATOR_INVALID when createdBy is soft-deleted', async () => {
    ClientAccessToken.findById = () => mockPopulateQuery({ createdBy: activeCreator({ isDeleted: true }) });

    const req = {
      tenantId: 'tenant-1',
      tokenId: TOKEN_ID,
      otIds: [OT_A_ID],
      headers: {},
      body: {
        reportIds: [R1],
        signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Test', signerId: '12345' },
      },
    };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.sign(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'TOKEN_CREATOR_INVALID');
  });

  it('409 TOKEN_CREATOR_INVALID when createdBy has no fileFirma', async () => {
    ClientAccessToken.findById = () => mockPopulateQuery({ createdBy: activeCreator({ fileFirma: null }) });

    const req = {
      tenantId: 'tenant-1',
      tokenId: TOKEN_ID,
      otIds: [OT_A_ID],
      headers: {},
      body: {
        reportIds: [R1],
        signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Test', signerId: '12345' },
      },
    };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.sign(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'TOKEN_CREATOR_INVALID');
  });

  it('409 REPORT_ALREADY_SIGNED and rolls back inserted sheets when matchedCount < reportIds.length', async () => {
    ClientAccessToken.findById = () => mockPopulateQuery({ createdBy: activeCreator() });
    Report.find = () => mockQuery([reviewedReport(R1), reviewedReport(R2)]);
    OT.find = () => mockQuery([
      { _id: OT_A_ID, Consecutivo: 'OT-A', ClienteId: 'cliente-1', reportes: [R1, R2] },
    ]);
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma.png', storagePath: 'x' });
    Counter.findOneAndUpdate = () => ({ lean: () => Promise.resolve({ seq: 1 }) });

    SheetWork.insertMany = async (docs) => docs.map((d, i) => ({ ...d, _id: `sheet-${i + 1}` }));
    // bulkWrite reports zero matches — simulates a concurrent sign already
    // flipping the same reports (hojaDeTrabajo already set → our filter
    // excludes them → matchedCount 0).
    Report.bulkWrite = async () => ({ matchedCount: 0, modifiedCount: 0 });
    // Revert path calls Report.updateMany to $unset hojaDeTrabajo. Report.find
    // is called twice by the service (step 2 load + rollback conflict lookup);
    // the earlier mock at line 250 already returns docs whose `_id` field is
    // enough for the rollback path, so we don't override it here (doing so
    // would clobber the reviewed-reports fixture that step 2 needs).
    const updateManyRevertCalls = [];
    Report.updateMany = async (filter, update) => {
      updateManyRevertCalls.push({ filter, update });
      return { matchedCount: 0, modifiedCount: 0 };
    };

    let deleteManyFilter = null;
    SheetWork.deleteMany = async (filter) => { deleteManyFilter = filter; return { deletedCount: 1 }; };

    const req = {
      tenantId: 'tenant-1',
      tokenId: TOKEN_ID,
      otIds: [OT_A_ID],
      headers: {},
      body: {
        reportIds: [R1, R2],
        signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Test', signerId: '12345' },
      },
    };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.sign(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'REPORT_ALREADY_SIGNED');
    assert.ok(deleteManyFilter, 'SheetWork.deleteMany must be called to roll back');
    assert.equal(typeof deleteManyFilter['clientSignature.signedBatchId'], 'string');
  });
});
