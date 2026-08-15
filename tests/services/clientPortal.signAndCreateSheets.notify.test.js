/**
 * tests/services/clientPortal.signAndCreateSheets.notify.test.js
 *
 * `sheet.signed` instrumentation for the client-portal BATCH sign flow
 * (openspec/changes/notify-on-sheet-signed, tasks.md 2.1/4.1/4.5). DB-free —
 * every Mongoose model static + the Firebase upload boundary is mocked;
 * `notificationService.emit` is monkey-patched to a spy so we can assert on
 * invocation count and payload shape without touching the real bus.
 */
import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';
import { Report } from '../../src/models/report.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { clientPortalService } from '../../src/services/clientPortal.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { notificationService } from '../../src/services/notification.service.js';

/** Query stub supporting `.select()`/`.lean()` (used by OT.find, Report.find, Customer.find). */
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

const TENANT = 'tenant-1';
const TOKEN_ID = '507f1f77bcf86cd799439001';
const CREATOR_ID = '507f1f77bcf86cd799439002';
const OT_A = '507f1f77bcf86cd799439010';
const OT_B = '507f1f77bcf86cd799439011';
const OT_C = '507f1f77bcf86cd799439012';
const R1 = '507f1f77bcf86cd799439021';
const R2 = '507f1f77bcf86cd799439022';
const R3 = '507f1f77bcf86cd799439023';

const VALID_SIGNATURE_BASE64 = Buffer.from(
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)])
).toString('base64');

function activeCreator() {
  return {
    _id: CREATOR_ID,
    fullName: 'Juan Técnico',
    role: 'admin',
    fileFirma: 'https://cdn/firma-tecnico.png',
    isDeleted: false,
  };
}

function reviewedReport(id) {
  return {
    _id: id,
    tenantId: TENANT,
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    clientReview: { reviewedAt: new Date('2026-08-01T00:00:00.000Z') },
    estado: 'Cerrado',
    isFromTicket: false,
    ticket: null,
  };
}

describe('clientPortalService.signAndCreateSheets — sheet.signed notify', () => {
  const originalEmit = notificationService.emit;

  // Every test drives OT.findOne -> null (no Consecutivo) so
  // `_resolveNumeroHoja` falls back to the global `getNextSequence` counter,
  // which needs Counter.findOneAndUpdate stubbed to avoid a real DB call.
  let seq = 0;
  beforeEach(() => {
    seq = 0;
    Counter.findOneAndUpdate = () => ({ lean: () => Promise.resolve({ seq: (seq += 1) }) });
  });

  afterEach(() => {
    delete ClientAccessToken.findById;
    delete Report.find;
    delete OT.find;
    delete OT.findOne;
    delete OT.findOneAndUpdate;
    delete Customer.find;
    delete SheetWork.insertMany;
    delete SheetWork.deleteMany;
    delete SheetWork.find;
    delete SheetWork.countDocuments;
    delete Report.updateMany;
    delete Report.bulkWrite;
    delete Report.countDocuments;
    delete firebaseStorageService.uploadEvidencia;
    delete Counter.findOneAndUpdate;
    notificationService.emit = originalEmit;
  });

  it('dispatches sheet.signed exactly once per HT that transitioned to signed (3 OTs -> 3 emits, signedVia=portal)', async () => {
    ClientAccessToken.findById = () => mockPopulateQuery({ createdBy: activeCreator() });
    Report.find = () => mockQuery([reviewedReport(R1), reviewedReport(R2), reviewedReport(R3)]);
    OT.find = () => mockQuery([
      { _id: OT_A, Consecutivo: 'OT-A', ClienteId: 'cliente-a', reportes: [R1] },
      { _id: OT_B, Consecutivo: 'OT-B', ClienteId: 'cliente-b', reportes: [R2] },
      { _id: OT_C, Consecutivo: 'OT-C', ClienteId: 'cliente-c', reportes: [R3] },
    ]);
    Customer.find = () => mockQuery([
      { _id: 'cliente-a', Razonsocial: 'Cliente A' },
      { _id: 'cliente-b', Razonsocial: 'Cliente B' },
      { _id: 'cliente-c', Razonsocial: 'Cliente C' },
    ]);
    OT.findOne = () => mockQuery(null); // numeroHoja global-counter fallback path irrelevant here
    SheetWork.countDocuments = async () => 0;
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma.png' });
    SheetWork.insertMany = async (docs) => docs.map((d, i) => ({ ...d, _id: `sheet-${i + 1}`, numeroHoja: `HT-${i + 1}` }));
    Report.bulkWrite = async (ops) => {
      const total = ops.reduce((n, op) => n + op.updateMany.filter._id.$in.length, 0);
      return { matchedCount: total, modifiedCount: total };
    };
    Report.updateMany = async () => ({});
    Report.countDocuments = async () => 1;
    OT.findOneAndUpdate = async () => ({});
    SheetWork.find = () => mockQuery([]);

    const emitCalls = [];
    notificationService.emit = async (tenantId, event, payload) => {
      emitCalls.push({ tenantId, event, payload });
      return { dispatched: 1, recipients: ['admin-1'] };
    };

    const result = await clientPortalService.signAndCreateSheets(
      TENANT,
      TOKEN_ID,
      [OT_A, OT_B, OT_C],
      { reportIds: [R1, R2, R3], signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Test', signerId: '1' } },
      { ip: '10.0.0.1', userAgent: 'jest' }
    );

    assert.equal(result.sheetIds.length, 3, 'sanity: 3 sheets created');
    assert.equal(emitCalls.length, 3, 'exactly one sheet.signed emit per HT');
    for (const call of emitCalls) {
      assert.equal(call.tenantId, TENANT);
      assert.equal(call.event, 'sheet.signed');
      assert.equal(call.payload.signedVia, 'portal');
      assert.ok(call.payload.sheetId, 'payload has sheetId');
      assert.ok(call.payload.otId, 'payload has otId');
      assert.ok(call.payload.otConsecutivo, 'payload has otConsecutivo');
      assert.ok(call.payload.customerName, 'payload has customerName');
      assert.match(call.payload.title, /^HT .+ firmada$/);
      assert.match(call.payload.body, /vía portal cliente$/);
      assert.equal(
        call.payload.data.link,
        `/ots/${call.payload.otId}?preview_sheet=${call.payload.sheetId}`,
      );
    }
    const customerNames = emitCalls.map((c) => c.payload.customerName).sort();
    assert.deepEqual(customerNames, ['Cliente A', 'Cliente B', 'Cliente C']);
  });

  it('does NOT emit at all when the whole batch conflicts/rolls back (no partial success)', async () => {
    ClientAccessToken.findById = () => mockPopulateQuery({ createdBy: activeCreator() });
    Report.find = () => mockQuery([reviewedReport(R1), reviewedReport(R2)]);
    OT.find = () => mockQuery([
      { _id: OT_A, Consecutivo: 'OT-A', ClienteId: 'cliente-a', reportes: [R1, R2] },
    ]);
    Customer.find = () => mockQuery([{ _id: 'cliente-a', Razonsocial: 'Cliente A' }]);
    OT.findOne = () => mockQuery(null);
    SheetWork.countDocuments = async () => 0;
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma.png' });
    SheetWork.insertMany = async (docs) => docs.map((d, i) => ({ ...d, _id: `sheet-${i + 1}` }));
    // Both reports already have hojaDeTrabajo set by a concurrent request ->
    // matchedCount 0 for the whole batch -> full rollback + 409, no emit.
    Report.bulkWrite = async () => ({ matchedCount: 0, modifiedCount: 0 });
    Report.updateMany = async () => ({ matchedCount: 0, modifiedCount: 0 });
    SheetWork.deleteMany = async () => ({ deletedCount: 1 });

    let emitCalled = false;
    notificationService.emit = async () => { emitCalled = true; };

    await assert.rejects(
      clientPortalService.signAndCreateSheets(
        TENANT,
        TOKEN_ID,
        [OT_A],
        { reportIds: [R1, R2], signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Test', signerId: '1' } },
        {}
      ),
      (err) => err.code === 'REPORT_ALREADY_SIGNED'
    );
    assert.equal(emitCalled, false, 'no sheet.signed emit on a batch that never durably persisted as signed');
  });

  it('a notificationService.emit throw does NOT abort the sign — sheets are still created and returned', async () => {
    ClientAccessToken.findById = () => mockPopulateQuery({ createdBy: activeCreator() });
    Report.find = () => mockQuery([reviewedReport(R1)]);
    OT.find = () => mockQuery([
      { _id: OT_A, Consecutivo: 'OT-A', ClienteId: 'cliente-a', reportes: [R1] },
    ]);
    Customer.find = () => mockQuery([{ _id: 'cliente-a', Razonsocial: 'Cliente A' }]);
    OT.findOne = () => mockQuery(null);
    SheetWork.countDocuments = async () => 0;
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma.png' });
    SheetWork.insertMany = async (docs) => docs.map((d, i) => ({ ...d, _id: `sheet-${i + 1}` }));
    Report.bulkWrite = async () => ({ matchedCount: 1, modifiedCount: 1 });
    Report.updateMany = async () => ({});
    Report.countDocuments = async () => 1;
    OT.findOneAndUpdate = async () => ({});
    SheetWork.find = () => mockQuery([]);

    notificationService.emit = async () => { throw new Error('bus is down'); };

    const result = await clientPortalService.signAndCreateSheets(
      TENANT,
      TOKEN_ID,
      [OT_A],
      { reportIds: [R1], signature: { imagePng: VALID_SIGNATURE_BASE64, signerName: 'Cliente Test', signerId: '1' } },
      {}
    );

    assert.equal(result.sheetIds.length, 1, 'signature persists even though the bus throws');
    assert.equal(result.pdfStatus, 'pending');
  });
});
