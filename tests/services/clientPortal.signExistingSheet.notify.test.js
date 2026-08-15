/**
 * tests/services/clientPortal.signExistingSheet.notify.test.js
 *
 * `sheet.signed` instrumentation for the client-portal LATE-SIGN flow
 * (openspec/changes/notify-on-sheet-signed, tasks.md 2.2/4.2/4.5). DB-free —
 * `notificationService.emit` is monkey-patched to a spy.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { clientPortalService } from '../../src/services/clientPortal.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { notificationService } from '../../src/services/notification.service.js';

const TENANT = 'tenant-1';
const TOKEN_ID = '507f1f77bcf86cd799439001';
const SHEET_ID = '507f1f77bcf86cd799439030';
const OT_ID = '507f1f77bcf86cd799439010';

const VALID_SIGNATURE_BASE64 = Buffer.from(
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)])
).toString('base64');

function preSheet() {
  return {
    _id: SHEET_ID,
    tenantId: TENANT,
    firmaFile: '',
    clientSignature: { tokenId: TOKEN_ID, signedBatchId: 'batch-1' },
  };
}

/** `findOneAndUpdate(...).populate(...).populate(...)` chain, resolving to `updatedSheet`. */
function mockUpdateQuery(updatedSheet) {
  const q = {
    populate: () => q,
    then: (resolve, reject) => Promise.resolve(updatedSheet).then(resolve, reject),
    catch: (reject) => Promise.resolve(updatedSheet).catch(reject),
  };
  return q;
}

function updatedSheet() {
  return {
    _id: SHEET_ID,
    numeroHoja: 'OT-1-2',
    otId: { _id: OT_ID, Consecutivo: 'OT-1' },
    clienteId: { _id: 'cliente-1', Razonsocial: 'Cliente Tardío S.A.S.' },
    clientSignature: { signedBatchId: 'batch-1' },
  };
}

describe('clientPortalService.signExistingSheet — sheet.signed notify', () => {
  const originalEmit = notificationService.emit;

  afterEach(() => {
    delete SheetWork.findOne;
    delete SheetWork.findOneAndUpdate;
    delete SheetWork.find;
    delete firebaseStorageService.uploadEvidencia;
    notificationService.emit = originalEmit;
  });

  it('dispatches sheet.signed exactly once with signedVia=portal and the correct payload', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve(preSheet()) });
    SheetWork.findOneAndUpdate = () => mockUpdateQuery(updatedSheet());
    SheetWork.find = () => ({ lean: () => Promise.resolve([]) });
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma-late.png' });

    const emitCalls = [];
    notificationService.emit = async (tenantId, event, payload) => {
      emitCalls.push({ tenantId, event, payload });
      return { dispatched: 1, recipients: ['admin-1'] };
    };

    const result = await clientPortalService.signExistingSheet(
      TENANT,
      TOKEN_ID,
      SHEET_ID,
      { signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Tardío' } },
      { ip: '10.0.0.1', userAgent: 'jest' }
    );

    assert.equal(result.sheetId, SHEET_ID);
    assert.equal(emitCalls.length, 1);
    const { tenantId, event, payload } = emitCalls[0];
    assert.equal(tenantId, TENANT);
    assert.equal(event, 'sheet.signed');
    assert.equal(payload.signedVia, 'portal');
    assert.equal(payload.sheetId, SHEET_ID);
    assert.equal(payload.otId, OT_ID);
    assert.equal(payload.otConsecutivo, 'OT-1');
    assert.equal(payload.customerName, 'Cliente Tardío S.A.S.');
    assert.equal(payload.sheetNumero, 'OT-1-2');
    assert.equal(payload.title, 'HT OT-1-2 firmada');
    assert.equal(payload.body, 'OT OT-1 · Cliente Tardío S.A.S. · vía portal cliente');
    assert.equal(payload.data.link, `/ots/${OT_ID}?preview_sheet=${payload.sheetId}`);
  });

  it('a notificationService.emit throw does NOT abort the late-sign response', async () => {
    SheetWork.findOne = () => ({ lean: () => Promise.resolve(preSheet()) });
    SheetWork.findOneAndUpdate = () => mockUpdateQuery(updatedSheet());
    SheetWork.find = () => ({ lean: () => Promise.resolve([]) });
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma-late.png' });

    notificationService.emit = async () => { throw new Error('bus is down'); };

    const result = await clientPortalService.signExistingSheet(
      TENANT,
      TOKEN_ID,
      SHEET_ID,
      { signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Tardío' } },
      {}
    );

    assert.equal(result.sheetId, SHEET_ID);
    assert.equal(result.pdfStatus, 'pending');
  });
});
