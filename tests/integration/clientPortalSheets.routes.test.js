/**
 * tests/integration/clientPortalSheets.routes.test.js
 *
 * Updated for sheetwork-share-and-portal-widening: portal reads now widen to
 * every signed HT whose otId is in the current token's scope. Writes
 * (signExistingSheet) stay under D12 — covered by clientPortalSignExisting.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';
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

function mockTokenA() {
  ClientAccessToken.findById = () => ({
    select: () => ({ lean: () => Promise.resolve({ otIds: [OT_ID] }) }),
  });
}

function mockTokenBEmpty() {
  ClientAccessToken.findById = () => ({
    select: () => ({ lean: () => Promise.resolve({ otIds: [] }) }),
  });
}

describe('GET /public/client-view/:token/sheets (widened)', () => {
  afterEach(() => { delete SheetWork.find; delete ClientAccessToken.findById; });

  it('returns signed sheets whose otId is in token.otIds — regardless of clientSignature.tokenId', async () => {
    mockTokenA();
    let capturedFilter = null;
    SheetWork.find = (filter) => {
      capturedFilter = filter;
      return mockQuery([
        {
          _id: SHEET_ID,
          numeroHoja: 'H0001',
          otId: { _id: OT_ID, Consecutivo: 'OT-A' },
          clientSignature: { tokenId: 'ANY-OTHER-TOKEN', signedAt: new Date('2026-08-01T00:00:00.000Z') },
          pdfStatus: 'ready',
          PdfHojaTrabajo: 'https://cdn/ht.pdf',
          firmaFile: 'https://cdn/firma.png',
        },
      ]);
    };

    const req = { tenantId: 'tenant-1', tokenId: TOKEN_A };
    const res = buildRes();
    await clientPortalController.getSheets(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.sheets.length, 1);
    assert.equal(res.body.data.sheets[0].otConsecutivo, 'OT-A');
    // Filter now uses otId.$in, not clientSignature.tokenId
    assert.deepEqual(capturedFilter.otId, { $in: [OT_ID] });
    // firmaFile filter present so unsigned sheets are excluded
    assert.ok(capturedFilter.firmaFile);
    assert.equal(capturedFilter.tenantId, 'tenant-1');
  });

  it('returns empty when the token has no otIds in scope', async () => {
    mockTokenBEmpty();
    SheetWork.find = () => mockQuery([]);
    const req = { tenantId: 'tenant-1', tokenId: TOKEN_B };
    const res = buildRes();
    await clientPortalController.getSheets(req, res, (err) => { throw err; });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.sheets, []);
  });

  it('includes pdfStatus and pdfUrl fields (null while pending)', async () => {
    mockTokenA();
    SheetWork.find = () => mockQuery([
      {
        _id: SHEET_ID,
        numeroHoja: 'H0002',
        otId: { _id: OT_ID, Consecutivo: 'OT-A' },
        clientSignature: { signedAt: new Date() },
        firmaFile: 'https://cdn/firma.png',
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

describe('GET /public/client-view/:token/sheets/:sheetId/pdf (widened)', () => {
  afterEach(() => { delete SheetWork.findOne; delete ClientAccessToken.findById; });

  it('redirects (302) to the PDF URL when pdfStatus is ready', async () => {
    mockTokenA();
    SheetWork.findOne = () => mockQuery({ _id: SHEET_ID, pdfStatus: 'ready', PdfHojaTrabajo: 'https://cdn/ht.pdf' });
    const req = { tenantId: 'tenant-1', tokenId: TOKEN_A, params: { sheetId: SHEET_ID } };
    const res = buildRes();
    await clientPortalController.getSheetPdf(req, res, (err) => { throw err; });
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectedTo, 'https://cdn/ht.pdf');
  });

  it('425 when pdfStatus is pending', async () => {
    mockTokenA();
    SheetWork.findOne = () => mockQuery({ _id: SHEET_ID, pdfStatus: 'pending', PdfHojaTrabajo: null });
    const req = { tenantId: 'tenant-1', tokenId: TOKEN_A, params: { sheetId: SHEET_ID } };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.getSheetPdf(req, res, (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 425);
    assert.equal(capturedErr.code, 'PDF_PENDING');
  });

  it('404 when the sheet is out of the token OT scope', async () => {
    mockTokenBEmpty();
    // service short-circuits before hitting SheetWork.findOne when otIds is empty
    const req = { tenantId: 'tenant-1', tokenId: TOKEN_B, params: { sheetId: SHEET_ID } };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.getSheetPdf(req, res, (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'SHEET_NOT_FOUND');
  });

  it('404 when the sheet belongs to a different tenant (findOne returns null)', async () => {
    mockTokenA();
    SheetWork.findOne = () => mockQuery(null);
    const req = { tenantId: 'tenant-2', tokenId: TOKEN_A, params: { sheetId: SHEET_ID } };
    const res = buildRes();
    let capturedErr = null;
    await clientPortalController.getSheetPdf(req, res, (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'SHEET_NOT_FOUND');
  });
});
