/**
 * tests/services/publicSheetSign.notify.test.js
 *
 * `sheet.signed` instrumentation for the REMOTE-SIGN public link flow
 * (openspec/changes/notify-on-sheet-signed, tasks.md 2.3/4.3/4.5). Exercises
 * the real `sheetWorkService._finalizeSignedSheet(..., 'remote-sign')` shared
 * helper — DB-free, `notificationService.emit` monkey-patched to a spy.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { publicSheetSignService } from '../../src/services/publicSheetSign.service.js';
import { sheetWorkSignTokenService } from '../../src/services/sheetWorkSignToken.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { notificationService } from '../../src/services/notification.service.js';

const TENANT = 'tenant-a';
const SHEET_ID = '507f1f77bcf86cd799439030';
const TOKEN_ID = '507f1f77bcf86cd799439040';
const OT_ID = '507f1f77bcf86cd799439010';

/** Query stub supporting `.select().lean()` (OT.findOne / Customer.findOne). */
function selectLeanQuery(result) {
  return { select: () => ({ lean: () => Promise.resolve(result) }), lean: () => Promise.resolve(result) };
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

function stubHappyPath() {
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
    _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, clienteId: 'cliente-1', reports: [],
    numeroHoja: 'HT-9', estado: 'Firmada', firmaFile: 'https://firebase/f.png',
    toObject() {
      return { _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, clienteId: 'cliente-1', reports: [], numeroHoja: 'HT-9' };
    },
  };
  SheetWork.findOneAndUpdate = async () => updatedSheet;
  sheetWorkSignTokenService.renewOnSign = async (_id, signedAt) => ({
    expiresAt: new Date(signedAt.getTime() + 7 * 24 * 3600 * 1000),
  });
  // _finalizeSignedSheet's body (before the notify block): reports:[] short-circuits
  // the Report.updateMany + ticket-cascade Report.find; otId truthy -> countDocuments x2 + findOneAndUpdate.
  Report.countDocuments = async () => 0;
  OT.findOneAndUpdate = async () => ({});
  // notify block: OT.findOne / Customer.findOne for the sheet.signed payload.
  OT.findOne = () => selectLeanQuery({ _id: OT_ID, Consecutivo: 'OT-9' });
  Customer.findOne = () => selectLeanQuery({ _id: 'cliente-1', Razonsocial: 'Cliente Remoto S.A.S.' });
}

describe('publicSheetSignService.signWithToken — sheet.signed notify', () => {
  const originalEmit = notificationService.emit;

  afterEach(() => {
    delete sheetWorkSignTokenService.resolveByToken;
    delete sheetWorkSignTokenService.renewOnSign;
    delete SheetWork.findOne;
    delete SheetWork.findOneAndUpdate;
    delete firebaseStorageService.uploadEvidencia;
    delete Report.countDocuments;
    delete OT.findOneAndUpdate;
    delete OT.findOne;
    delete Customer.findOne;
    notificationService.emit = originalEmit;
  });

  it('dispatches sheet.signed exactly once with signedVia=remote-sign', async () => {
    stubHappyPath();
    const emitCalls = [];
    notificationService.emit = async (tenantId, event, payload) => {
      emitCalls.push({ tenantId, event, payload });
      return { dispatched: 1, recipients: ['admin-1'] };
    };

    const result = await publicSheetSignService.signWithToken(
      'tok',
      { signature: { imagePng: await drawnPngBase64(), signerName: 'Cliente Firmante' } },
      { ip: '1.2.3.4', userAgent: 'jest' }
    );

    assert.equal(result.status, 'signed');
    assert.equal(emitCalls.length, 1);
    const { tenantId, event, payload } = emitCalls[0];
    assert.equal(tenantId, TENANT);
    assert.equal(event, 'sheet.signed');
    assert.equal(payload.signedVia, 'remote-sign');
    assert.equal(payload.sheetId, SHEET_ID);
    assert.equal(payload.otId, OT_ID);
    assert.equal(payload.otConsecutivo, 'OT-9');
    assert.equal(payload.customerName, 'Cliente Remoto S.A.S.');
    assert.match(payload.body, /vía enlace remoto$/);
    assert.equal(payload.data.link, `/ots/${OT_ID}?preview_sheet=${payload.sheetId}`);
  });

  it('a notificationService.emit throw does NOT abort the remote-sign response', async () => {
    stubHappyPath();
    notificationService.emit = async () => { throw new Error('bus is down'); };

    const result = await publicSheetSignService.signWithToken(
      'tok',
      { signature: { imagePng: await drawnPngBase64(), signerName: 'Cliente Firmante' } },
      {}
    );

    assert.equal(result.status, 'signed');
    assert.equal(result.pdfStatus, 'pending');
  });
});
