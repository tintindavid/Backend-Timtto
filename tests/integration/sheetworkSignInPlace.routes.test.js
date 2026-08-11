/**
 * tests/integration/sheetworkSignInPlace.routes.test.js
 *
 * DB-free tests for POST /api/v1/sheetwork/:sheetId/sign-inplace.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { SheetWorkSignToken } from '../../src/models/sheetWorkSignToken.model.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { sheetWorkController } from '../../src/controllers/sheetwork.controller.js';
import { sheetWorkSignTokenService } from '../../src/services/sheetWorkSignToken.service.js';

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
const OT_ID = '507f1f77bcf86cd799439010';
const USER_ID = '507f1f77bcf86cd799439099';

describe('POST /api/v1/sheetwork/:sheetId/sign-inplace', () => {
  afterEach(() => {
    delete SheetWork.findOne;
    delete Report.updateMany;
    delete Report.countDocuments;
    delete Report.find;
    delete OT.findOneAndUpdate;
    delete SheetWorkSignToken.updateOne;
    delete firebaseStorageService.uploadEvidencia;
    delete sheetWorkSignTokenService.markSuperseded;
  });

  it('closes an EnviadaAFirmar sheet, marks the outstanding token superseded, returns 200', async () => {
    const sheetDoc = {
      _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, estado: 'EnviadaAFirmar',
      firmaFile: null, reports: [], numeroHoja: 'OT-1-1',
      async save() { this.saved = true; },
      toObject() { return { _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, reports: [], numeroHoja: 'OT-1-1' }; },
    };
    SheetWork.findOne = () => Promise.resolve(sheetDoc);
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://firebase/fake.png' });
    let supersedeCalled = false;
    sheetWorkSignTokenService.markSuperseded = async () => { supersedeCalled = true; };
    Report.updateMany = async () => ({});
    Report.countDocuments = async () => 0;
    OT.findOneAndUpdate = async () => ({});
    Report.find = () => ({ select: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) });

    const req = {
      tenantId: TENANT, user: { userId: USER_ID }, params: { sheetId: SHEET_ID },
      body: { signature: { imagePng: await drawnPngBase64(), signerName: 'Firmante' } },
    };
    const res = buildRes();
    await sheetWorkController.signInPlace(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.estado, 'Firmada');
    assert.equal(supersedeCalled, true);
    assert.equal(sheetDoc.estado, 'Firmada');
    assert.equal(sheetDoc.firmaFile, 'https://firebase/fake.png');
    assert.equal(sheetDoc.saved, true);
  });

  it('rejects 409 SHEET_ALREADY_SIGNED when the sheet is Firmada', async () => {
    SheetWork.findOne = () => Promise.resolve({ _id: SHEET_ID, tenantId: TENANT, estado: 'Firmada' });
    const req = {
      tenantId: TENANT, user: { userId: USER_ID }, params: { sheetId: SHEET_ID },
      body: { signature: { imagePng: await drawnPngBase64(), signerName: 'X' } },
    };
    let capturedErr = null;
    await sheetWorkController.signInPlace(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'SHEET_ALREADY_SIGNED');
  });

  it('rejects 400 INVALID_SIGNATURE_IMAGE when the PNG is blank', async () => {
    SheetWork.findOne = () => Promise.resolve({
      _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, estado: 'EnviadaAFirmar', firmaFile: null,
    });
    const req = {
      tenantId: TENANT, user: { userId: USER_ID }, params: { sheetId: SHEET_ID },
      body: { signature: { imagePng: await blankPngBase64(), signerName: 'X' } },
    };
    let capturedErr = null;
    await sheetWorkController.signInPlace(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'INVALID_SIGNATURE_IMAGE');
  });
});
