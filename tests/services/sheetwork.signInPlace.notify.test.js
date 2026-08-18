/**
 * tests/services/sheetwork.signInPlace.notify.test.js
 *
 * `sheet.signed` instrumentation for the panel SIGN-IN-PLACE flow
 * (openspec/changes/notify-on-sheet-signed, tasks.md 2.4/4.4/4.5). Exercises
 * the real `sheetWorkService._finalizeSignedSheet(..., 'in-place')` shared
 * helper — DB-free, `notificationService.emit` monkey-patched to a spy.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { User } from '../../src/models/user.model.js';
import { sheetWorkService } from '../../src/services/sheetwork.service.js';
import { sheetWorkSignTokenService } from '../../src/services/sheetWorkSignToken.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { notificationService } from '../../src/services/notification.service.js';

const TENANT = 'tenant-a';
const SHEET_ID = '507f1f77bcf86cd799439030';
const OT_ID = '507f1f77bcf86cd799439010';
const USER_ID = '507f1f77bcf86cd799439099';

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
  const sheetDoc = {
    _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, clienteId: 'cliente-1',
    estado: 'EnviadaAFirmar', firmaFile: null, reports: [], numeroHoja: 'OT-1-1',
    async save() { this.saved = true; },
    toObject() {
      return { _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, clienteId: 'cliente-1', reports: [], numeroHoja: 'OT-1-1' };
    },
  };
  SheetWork.findOne = () => Promise.resolve(sheetDoc);
  firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://firebase/fake.png' });
  sheetWorkSignTokenService.markSuperseded = async () => {};
  // Defensive fallback in _finalizeSignedSheet: when reports:[] is empty
  // we look up by hojaDeTrabajo — mock returns empty to preserve original behavior.
  Report.find = () => ({ select: () => ({ lean: async () => [] }) });
  Report.countDocuments = async () => 0;
  OT.findOneAndUpdate = async () => ({});
  OT.findOne = () => selectLeanQuery({ _id: OT_ID, Consecutivo: 'OT-1' });
  Customer.findOne = () => selectLeanQuery({ _id: 'cliente-1', Razonsocial: 'Cliente Presencial' });
  // signInPlace now requires a firmante lookup — provide a valid signer.
  User.findOne = () => ({
    lean: () => Promise.resolve({
      _id: USER_ID,
      firstName: 'Test',
      lastName: 'Signer',
      email: 'test@example.com',
      role: 'admin',
      fileFirma: 'https://firebase/signer.png',
    }),
  });
  return sheetDoc;
}

describe('sheetWorkService.signInPlace — sheet.signed notify', () => {
  const originalEmit = notificationService.emit;

  afterEach(() => {
    delete SheetWork.findOne;
    delete firebaseStorageService.uploadEvidencia;
    delete sheetWorkSignTokenService.markSuperseded;
    delete Report.find;
    delete Report.countDocuments;
    delete OT.findOneAndUpdate;
    delete OT.findOne;
    delete Customer.findOne;
    delete User.findOne;
    notificationService.emit = originalEmit;
  });

  it('dispatches sheet.signed exactly once with signedVia=in-place', async () => {
    stubHappyPath();
    const emitCalls = [];
    notificationService.emit = async (tenantId, event, payload) => {
      emitCalls.push({ tenantId, event, payload });
      return { dispatched: 1, recipients: ['admin-1'] };
    };

    const result = await sheetWorkService.signInPlace(
      SHEET_ID,
      { signature: { imagePng: await drawnPngBase64(), signerName: 'Técnico Firmante' } },
      TENANT,
      USER_ID
    );

    assert.equal(result.estado, 'Firmada');
    assert.equal(emitCalls.length, 1);
    const { tenantId, event, payload } = emitCalls[0];
    assert.equal(tenantId, TENANT);
    assert.equal(event, 'sheet.signed');
    assert.equal(payload.signedVia, 'in-place');
    assert.equal(payload.sheetId, SHEET_ID);
    assert.equal(payload.otId, OT_ID);
    assert.equal(payload.otConsecutivo, 'OT-1');
    assert.equal(payload.customerName, 'Cliente Presencial');
    assert.match(payload.body, /vía presencial$/);
    assert.equal(payload.data.link, `/ots/${OT_ID}?preview_sheet=${payload.sheetId}`);
  });

  it('a notificationService.emit throw does NOT abort the sign-in-place response', async () => {
    stubHappyPath();
    notificationService.emit = async () => { throw new Error('bus is down'); };

    const result = await sheetWorkService.signInPlace(
      SHEET_ID,
      { signature: { imagePng: await drawnPngBase64(), signerName: 'Técnico Firmante' } },
      TENANT,
      USER_ID
    );

    assert.equal(result.estado, 'Firmada');
    assert.equal(result.pdfStatus, 'pending');
  });
});
