/**
 * tests/integration/publicSheetDownload.routes.test.js
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { publicSheetDownloadController } from '../../src/controllers/publicSheetDownload.controller.js';
import { publicSheetDownloadService } from '../../src/services/publicSheetDownload.service.js';
import { sheetWorkDownloadTokenService } from '../../src/services/sheetWorkDownloadToken.service.js';

function buildRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    set(k, v) { if (typeof k === 'object') { Object.assign(this.headers, k); return this; } this.headers[k] = v; return this; },
  };
}

const activeToken = () => ({
  _id: 'tok-1',
  status: 'active',
  tenantId: 't',
  sheetId: 'sheet-1',
  otId: 'ot-1',
  clienteId: 'c-1',
  expiresAt: new Date(Date.now() + 60_000),
  downloadsAllowed: 3,
  downloadsUsed: 0,
  allowReports: false,
  reportDownloadsAllowed: 0,
  reportDownloadsUsed: 0,
});

describe('/public/sheet-download — meta endpoint', () => {
  afterEach(() => {
    delete publicSheetDownloadService.getMeta;
  });

  it('returns 200 with the metadata payload', async () => {
    publicSheetDownloadService.getMeta = async () => ({ status: 'active', sheetNumero: 'OT-1-1' });
    const req = { downloadToken: activeToken() };
    const res = buildRes();
    await publicSheetDownloadController.get(req, res, (err) => { if (err) throw err; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.sheetNumero, 'OT-1-1');
  });
});

describe('/public/sheet-download/:token/pdf — download', () => {
  afterEach(() => {
    delete sheetWorkDownloadTokenService.incrementHtDownload;
    delete publicSheetDownloadService.streamHtPdf;
  });

  it('streams the PDF on success', async () => {
    sheetWorkDownloadTokenService.incrementHtDownload = async () => ({ ok: true, doc: activeToken() });
    publicSheetDownloadService.streamHtPdf = async () => ({ pdfBuffer: Buffer.from('pdf'), filename: 'HT-1.pdf' });
    const req = { downloadToken: activeToken() };
    const res = buildRes();
    await publicSheetDownloadController.downloadPdf(req, res, (err) => { if (err) throw err; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/pdf');
    assert.ok(res.body instanceof Buffer);
  });

  it('returns 410 DOWNLOAD_EXHAUSTED when the quota is full', async () => {
    // The service throws before the controller can respond.
    publicSheetDownloadService.streamHtPdf = async () => {
      const { ApiError } = await import('../../src/utils/apiError.util.js');
      throw new ApiError(410, 'Sin descargas disponibles', 'DOWNLOAD_EXHAUSTED');
    };
    const req = { downloadToken: activeToken() };
    let capturedErr = null;
    await publicSheetDownloadController.downloadPdf(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 410);
    assert.equal(capturedErr.code, 'DOWNLOAD_EXHAUSTED');
  });
});

describe('/public/sheet-download/:token/reports.zip — download', () => {
  afterEach(() => {
    delete publicSheetDownloadService.streamReportsZip;
  });

  it('returns 403 REPORTS_NOT_ALLOWED when allowReports is false', async () => {
    publicSheetDownloadService.streamReportsZip = async () => {
      const { ApiError } = await import('../../src/utils/apiError.util.js');
      throw new ApiError(403, 'Los reportes no están habilitados', 'REPORTS_NOT_ALLOWED');
    };
    const req = { downloadToken: activeToken() };
    let capturedErr = null;
    await publicSheetDownloadController.downloadReportsZip(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 403);
    assert.equal(capturedErr.code, 'REPORTS_NOT_ALLOWED');
  });

  it('streams the ZIP on success', async () => {
    publicSheetDownloadService.streamReportsZip = async () => ({
      zipBuffer: Buffer.from('zip'), filename: 'reportes_OT-1-1_2026-08-11.zip',
    });
    const req = { downloadToken: { ...activeToken(), allowReports: true } };
    const res = buildRes();
    await publicSheetDownloadController.downloadReportsZip(req, res, (err) => { if (err) throw err; });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/zip');
  });
});
