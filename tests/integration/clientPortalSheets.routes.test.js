/**
 * tests/integration/clientPortalSheets.routes.test.js
 *
 * DB-free "integration" tests for GET /public/client-view/:token/sheets and
 * GET /public/client-view/:token/sheets/:sheetId/pdf (change B, design D12).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { clientPortalController } from '../../src/controllers/clientPortal.controller.js';

function buildRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    redirect(code, url) { this.statusCode = code; this.redirectedTo = url; },
  };
}

function mockQuery(result) {
  const q = {
    populate: () => q,
    sort: () => q,
    select: () => q,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
  return q;
}

const TOKEN_A = '507f1f77bcf86cd799439001';
const TOKEN_B = '507f1f77bcf86cd799439002';
const OT_ID = '507f1f77bcf86cd799439010';
const SHEET_ID = '507f1f77bcf86cd799439030';

describe('GET /public/client-view/:token/sheets', () => {
  afterEach(() => { delete SheetWork.find; });

  it('returns only sheets whose clientSignature.tokenId matches req.tokenId', async () => {
    let capturedFilter = null;
    SheetWork.find = (filter) => {
      capturedFilter = filter;
      // Simulate the DB-side filter: only return docs matching the tokenId
      // — real Mongoose would already exclude token B rows.
      const all = [
        {
          _id: SHEET_ID,
          numeroHoja: 'H0001',
          otId: { _id: OT_ID, Consecutivo: 'OT-A' },
          clientSignature: { tokenId: TOKEN_A, signedAt: new Date('2026-08-01T00:00:00.000Z') },
          pdfStatus: 'ready',
          PdfHojaTrabajo: 'https://cdn/ht.pdf',
        },
      ];
      return mockQuery(all.filter((s) => String(s.clientSignature.tokenId) === String(filter['clientSignature.tokenId'])));
    };

    const req = { tenantId: 'tenant-1', tokenId: TOKEN_A };
    const res = buildRes();
    await clientPortalController.getSheets(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.sheets.length, 1);
    assert.equal(res.body.data.sheets[0].otConsecutivo, 'OT-A');
    assert.equal(capturedFilter['clientSignature.tokenId'], TOKEN_A);
    assert.equal(capturedFilter.tenantId, 'tenant-1');
  });

  it('excludes sheets from another token entirely (empty result)', async () => {
    SheetWork.find = () => mockQuery([]);

    const req = { tenantId: 'tenant-1', tokenId: TOKEN_B };
    const res = buildRes();
    await clientPortalController.getSheets(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.sheets, []);
  });

  it('includes pdfStatus and pdfUrl fields (null while pending)', async () => {
    SheetWork.find = () => mockQuery([
      {
        _id: SHEET_ID,
        numeroHoja: 'H0002',
        otId: { _id: OT_ID, Consecutivo: 'OT-A' },
        clientSignature: { tokenId: TOKEN_A, signedAt: new Date() },
        pdfStatus: 'pending',
        PdfHojaTrabajo: null,
      },
    ]);

    const req = { tenantId: 'tenant-1', tokenId: TOKEN_A };
    const res = buildRes();
    await clientPortalController.getSheets(req, res, (err) => { throw err; });

    assert.equal(res.body.data.sheets[0].pdfStatus, 'pending');
    assert.equal(res.body.data.sheets[0].pdfUrl, null);
  });
});

describe('GET /public/client-view/:token/sheets/:sheetId/pdf', () => {
  afterEach(() => { delete SheetWork.findOne; });

  it('redirects (302) to the PDF URL when pdfStatus is ready', async () => {
    SheetWork.findOne = () => mockQuery({ _id: SHEET_ID, pdfStatus: 'ready', PdfHojaTrabajo: 'https://cdn/ht.pdf' });

    const req = { tenantId: 'tenant-1', tokenId: TOKEN_A, params: { sheetId: SHEET_ID } };
    const res = buildRes();
    await clientPortalController.getSheetPdf(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://cdn/ht.pdf');
  });

  it('425 when pdfStatus is pending', async () => {
    SheetWork.findOne = () => mockQuery({ _id: SHEET_ID, pdfStatus: 'pending', PdfHojaTrabajo: null });

    const req = { tenantId: 'tenant-1', tokenId: TOKEN_A, params: { sheetId: SHEET_ID } };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.getSheetPdf(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 425);
    assert.equal(capturedErr.code, 'PDF_PENDING');
  });

  it('404 when the sheet belongs to a different token', async () => {
    // SheetWork.findOne({ _id, tenantId, 'clientSignature.tokenId': tokenId })
    // simply finds nothing when the tokenId in the filter does not match.
    SheetWork.findOne = () => mockQuery(null);

    const req = { tenantId: 'tenant-1', tokenId: TOKEN_B, params: { sheetId: SHEET_ID } };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.getSheetPdf(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'SHEET_NOT_FOUND');
  });

  it('404 when the sheet belongs to a different tenant', async () => {
    SheetWork.findOne = () => mockQuery(null); // tenantId mismatch -> no doc

    const req = { tenantId: 'tenant-2', tokenId: TOKEN_A, params: { sheetId: SHEET_ID } };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.getSheetPdf(req, res, (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'SHEET_NOT_FOUND');
  });
});
