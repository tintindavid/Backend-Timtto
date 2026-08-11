/**
 * tests/integration/publicSheetSignGet.routes.test.js
 *
 * DB-free tests for GET /public/sheet-sign/:token.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { publicSheetSignController } from '../../src/controllers/publicSheetSign.controller.js';
import { publicSheetSignService } from '../../src/services/publicSheetSign.service.js';
import { sheetWorkSignTokenService } from '../../src/services/sheetWorkSignToken.service.js';

function buildRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
}

const SHEET_ID = '507f1f77bcf86cd799439030';
const TENANT = 'tenant-a';

function sheetChainable(sheetDoc) {
  const chain = {
    populate: () => chain,
    lean: () => Promise.resolve(sheetDoc),
  };
  return chain;
}

describe('GET /public/sheet-sign/:token', () => {
  afterEach(() => {
    delete SheetWork.findOne;
    delete Tenant.findOne;
    delete sheetWorkSignTokenService.resolveByToken;
    delete publicSheetSignService.pdfService;
  });

  it('returns 200 with previewHtml when the token is active', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => ({
      status: 'active',
      doc: { _id: 't', tenantId: TENANT, sheetId: SHEET_ID, expiresAt: new Date(Date.now() + 60_000) },
    });
    SheetWork.findOne = () => sheetChainable({
      _id: SHEET_ID, numeroHoja: 'OT-1-1', estado: 'EnviadaAFirmar',
      clienteId: { Razonsocial: 'Cliente Uno' }, otId: { Consecutivo: 'OT-2026-001' },
    });
    Tenant.findOne = () => ({ lean: () => Promise.resolve({ name: 'Tenant', logoUrl: null }) });
    publicSheetSignService.pdfService = { generateHTML: () => '<html>PREVIEW</html>' };

    const req = { params: { token: 'abc' } };
    const res = buildRes();
    await publicSheetSignController.get(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, 'active');
    assert.equal(res.body.data.previewHtml, '<html>PREVIEW</html>');
    assert.equal(res.body.data.sheet.numeroHoja, 'OT-1-1');
  });

  it('returns 200 with pdfUrl when the token is signed', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => ({
      status: 'signed',
      doc: { _id: 't', tenantId: TENANT, sheetId: SHEET_ID, expiresAt: new Date(Date.now() + 60_000) },
    });
    SheetWork.findOne = () => sheetChainable({
      _id: SHEET_ID, numeroHoja: 'OT-1-1', estado: 'Firmada',
      pdfStatus: 'ready', PdfHojaTrabajo: 'https://firebase/x.pdf',
      clienteId: null, otId: null,
    });
    Tenant.findOne = () => ({ lean: () => Promise.resolve({ name: 'T', logoUrl: null }) });

    const req = { params: { token: 'ok' } };
    const res = buildRes();
    await publicSheetSignController.get(req, res, (err) => { if (err) throw err; });

    assert.equal(res.body.data.status, 'signed');
    assert.equal(res.body.data.pdfUrl, 'https://firebase/x.pdf');
  });

  it('throws 410 for expired tokens', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => ({
      status: 'expired', doc: { _id: 't' },
    });
    const req = { params: { token: 'exp' } };
    let capturedErr = null;
    await publicSheetSignController.get(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 410);
    assert.match(capturedErr.code, /_EXPIRED$/);
  });

  it('throws 410 for revoked tokens', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => ({
      status: 'revoked', doc: { _id: 't' },
    });
    let capturedErr = null;
    await publicSheetSignController.get({ params: { token: 'r' } }, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 410);
    assert.match(capturedErr.code, /_REVOKED$/);
  });

  it('throws 410 for superseded tokens', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => ({
      status: 'superseded', doc: { _id: 't' },
    });
    let capturedErr = null;
    await publicSheetSignController.get({ params: { token: 's' } }, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 410);
    assert.match(capturedErr.code, /_SUPERSEDED$/);
  });

  it('throws 404 SHEET_SIGN_TOKEN_NOT_FOUND for unknown tokens', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => null;
    let capturedErr = null;
    await publicSheetSignController.get({ params: { token: '?' } }, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'SHEET_SIGN_TOKEN_NOT_FOUND');
  });
});
