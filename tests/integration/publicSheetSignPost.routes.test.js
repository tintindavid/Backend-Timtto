/**
 * tests/integration/publicSheetSignPost.routes.test.js
 *
 * DB-free tests for POST /public/sheet-sign/:token.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { User } from '../../src/models/user.model.js';
import { publicSheetSignController } from '../../src/controllers/publicSheetSign.controller.js';
import { sheetWorkSignTokenService } from '../../src/services/sheetWorkSignToken.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { sheetWorkService } from '../../src/services/sheetwork.service.js';

function buildRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
}

async function drawnPngBase64() {
  const w = 20, h = 20;
  const raw = Buffer.alloc(w * h * 4);
  for (let i = 0; i < raw.length; i += 4) { raw[i] = 255; raw[i + 1] = 255; raw[i + 2] = 255; raw[i + 3] = 255; }
  for (let i = 0; i < 40; i += 1) {
    const idx = i * 4;
    raw[idx] = 0; raw[idx + 1] = 0; raw[idx + 2] = 0; raw[idx + 3] = 255;
  }
  const buf = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return buf.toString('base64');
}

async function blankPngBase64() {
  const w = 20, h = 20;
  const raw = Buffer.alloc(w * h * 4);
  for (let i = 0; i < raw.length; i += 4) { raw[i] = 255; raw[i + 1] = 255; raw[i + 2] = 255; raw[i + 3] = 255; }
  const buf = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return buf.toString('base64');
}

const TENANT = 'tenant-a';
const SHEET_ID = '507f1f77bcf86cd799439030';
const TOKEN_ID = '507f1f77bcf86cd799439040';
const OT_ID = '507f1f77bcf86cd799439010';

describe('POST /public/sheet-sign/:token', () => {
  afterEach(() => {
    delete sheetWorkSignTokenService.resolveByToken;
    delete sheetWorkSignTokenService.renewOnSign;
    delete SheetWork.findOne;
    delete SheetWork.findOneAndUpdate;
    delete firebaseStorageService.uploadEvidencia;
    delete sheetWorkService._finalizeSignedSheet;
    delete OT.findById;
    delete User.findById;
  });

  it('signs a sheet, marks the token signed with renewed expiry, returns 200', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => ({
      status: 'active',
      doc: {
        _id: TOKEN_ID, tenantId: TENANT, sheetId: SHEET_ID, otId: OT_ID,
        token: 'tok', email: 'client@x.com', requestedBy: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    SheetWork.findOne = () => Promise.resolve({
      _id: SHEET_ID, tenantId: TENANT, estado: 'EnviadaAFirmar', firmaFile: null,
    });
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://firebase/f.png' });
    const updatedSheet = {
      _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, reports: [],
      estado: 'Firmada', firmaFile: 'https://firebase/f.png',
      toObject() { return { _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, reports: [] }; },
    };
    SheetWork.findOneAndUpdate = async () => updatedSheet;
    let renewCalled = false;
    sheetWorkSignTokenService.renewOnSign = async (_id, signedAt) => {
      renewCalled = true;
      return { expiresAt: new Date(signedAt.getTime() + 7 * 24 * 3600 * 1000) };
    };
    sheetWorkService._finalizeSignedSheet = async () => {};

    const req = {
      params: { token: 'tok' }, ip: '1.2.3.4', get: () => 'ua',
      body: { signature: { imagePng: await drawnPngBase64(), signerName: 'Cliente Firmante' } },
    };
    const res = buildRes();
    await publicSheetSignController.sign(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, 'signed');
    assert.equal(res.body.data.pdfStatus, 'pending');
    assert.equal(renewCalled, true);
  });

  it('returns 409 SHEET_ALREADY_SIGNED when the token is already signed', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => ({
      status: 'signed', doc: { _id: TOKEN_ID },
    });
    const req = {
      params: { token: 't' }, ip: '1', get: () => 'ua',
      body: { signature: { imagePng: await drawnPngBase64(), signerName: 'X' } },
    };
    let capturedErr = null;
    await publicSheetSignController.sign(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'SHEET_ALREADY_SIGNED');
  });

  it('returns 410 when the token expired between GET and POST', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => ({
      status: 'expired', doc: { _id: TOKEN_ID },
    });
    const req = {
      params: { token: 't' }, ip: '1', get: () => 'ua',
      body: { signature: { imagePng: await drawnPngBase64(), signerName: 'X' } },
    };
    let capturedErr = null;
    await publicSheetSignController.sign(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 410);
    assert.match(capturedErr.code, /_EXPIRED$/);
  });

  it('rejects a blank PNG with 400 INVALID_SIGNATURE_IMAGE', async () => {
    sheetWorkSignTokenService.resolveByToken = async () => ({
      status: 'active',
      doc: { _id: TOKEN_ID, tenantId: TENANT, sheetId: SHEET_ID, otId: OT_ID, token: 't', email: 'x@y.com', expiresAt: new Date(Date.now() + 60_000) },
    });
    const req = {
      params: { token: 'tok' }, ip: '1', get: () => 'ua',
      body: { signature: { imagePng: await blankPngBase64(), signerName: 'X' } },
    };
    let capturedErr = null;
    await publicSheetSignController.sign(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'INVALID_SIGNATURE_IMAGE');
  });
});
