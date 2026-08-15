/**
 * tests/integration/clientPortalSignExisting.routes.test.js
 *
 * DB-free "integration" tests for
 * POST /public/client-view/:token/sheets/:sheetId/sign (late-sign, design
 * D3/D7/D12, portal-signature-flow). Mocks the Mongoose model statics at
 * the DB boundary + the Firebase upload boundary; drives
 * validate(dto) -> controller -> service directly (no supertest in this
 * repo — same convention as tests/integration/clientPortalSign.routes.test.js).
 */
import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { clientPortalController } from '../../src/controllers/clientPortal.controller.js';
import { clientPortalLateSignDto } from '../../src/dtos/clientPortalSign.dto.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { notificationService } from '../../src/services/notification.service.js';

const TOKEN_ID = '507f1f77bcf86cd799439001';
const OTHER_TOKEN_ID = '507f1f77bcf86cd799439002';
const SHEET_ID = '507f1f77bcf86cd799439030';

function buildRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
  };
}

/** A PNG with a visible dark diagonal stroke over a white background. */
async function strokePngBase64() {
  const width = 40;
  const height = 20;
  const raw = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < Math.min(width, height); i += 1) {
    const idx = (i * width + i) * 4;
    raw[idx] = 0;
    raw[idx + 1] = 0;
    raw[idx + 2] = 0;
    raw[idx + 3] = 255;
  }
  const buf = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return buf.toString('base64');
}

async function blankPngBase64() {
  const buf = await sharp({
    create: { width: 40, height: 20, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return buf.toString('base64');
}

/**
 * The service reads once via `.findOne(...).lean()` (for the 404/409
 * distinction and to know the signedBatchId for PDF regen), then mutates
 * atomically via `.findOneAndUpdate(...)`. This helper mocks both so a
 * test can control both the pre-check state and the atomic-write outcome.
 */
function mockSheetLookup({ preSheet, updatedSheet }) {
  let capturedPreFilter = null;
  let capturedUpdateFilter = null;
  let capturedUpdate = null;
  SheetWork.findOne = (filter) => {
    capturedPreFilter = filter;
    return { lean: () => Promise.resolve(preSheet) };
  };
  // notify-on-sheet-signed: the service now chains
  // `.populate('otId', ...).populate('clienteId', ...)` onto the update
  // query to build the `sheet.signed` payload without extra round-trips —
  // the stub must stay awaitable AFTER 0, 1, or 2 `.populate()` calls.
  SheetWork.findOneAndUpdate = (filter, update) => {
    capturedUpdateFilter = filter;
    capturedUpdate = update;
    const q = {
      populate: () => q,
      then: (resolve, reject) => Promise.resolve(updatedSheet).then(resolve, reject),
      catch: (reject) => Promise.resolve(updatedSheet).catch(reject),
    };
    return q;
  };
  // Fire-and-forget PDF regen path calls SheetWork.find(...).lean().
  SheetWork.find = () => ({ lean: () => Promise.resolve([]) });
  return {
    getPreFilter: () => capturedPreFilter,
    getUpdateFilter: () => capturedUpdateFilter,
    getUpdate: () => capturedUpdate,
  };
}

function preSheetTemplate(overrides = {}) {
  return {
    _id: SHEET_ID,
    tenantId: 'tenant-1',
    firmaFile: '',
    clientSignature: {
      ip: '10.0.0.9',
      userAgent: 'old-agent',
      contentHash: 'original-hash',
      signedAt: new Date('2026-08-01T00:00:00.000Z'),
      signedBatchId: 'batch-original',
      tokenId: TOKEN_ID,
    },
    ...overrides,
  };
}

function updatedSheetTemplate(overrides = {}) {
  // Represents what findOneAndUpdate({new: true}) returns — the post-update
  // state. The service only reads `_id` and `clientSignature.signedBatchId`
  // from this doc, so we mimic just that.
  return {
    _id: SHEET_ID,
    clientSignature: { signedBatchId: 'batch-original' },
    ...overrides,
  };
}

describe('POST /public/client-view/:token/sheets/:sheetId/sign', () => {
  const originalEmit = notificationService.emit;

  // notify-on-sheet-signed: a successful late-sign now also calls
  // notificationService.emit once. Default no-op here — the notify wiring
  // itself is covered by tests/services/clientPortal.signExistingSheet.notify.test.js.
  beforeEach(() => {
    notificationService.emit = async () => ({ dispatched: 0, recipients: [] });
  });

  afterEach(() => {
    delete SheetWork.findOne;
    delete SheetWork.findOneAndUpdate;
    delete SheetWork.find;
    delete firebaseStorageService.uploadEvidencia;
    notificationService.emit = originalEmit;
  });

  it('same token + empty firmaFile + valid PNG -> 200 and writes only allowed fields', async () => {
    const stroke = await strokePngBase64();
    const spy = mockSheetLookup({
      preSheet: preSheetTemplate(),
      updatedSheet: updatedSheetTemplate(),
    });
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma-late.png', storagePath: 'x' });

    const req = {
      tenantId: 'tenant-1',
      tokenId: TOKEN_ID,
      params: { sheetId: SHEET_ID },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'client-agent' },
      body: { signature: { imagePng: stroke, signerName: 'Cliente Tardío' } },
    };
    await validate(clientPortalLateSignDto, 'body')(req, buildRes(), (err) => { if (err) throw err; });

    const res = buildRes();
    await clientPortalController.signExistingSheet(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.sheetId, SHEET_ID);
    assert.equal(res.body.data.pdfStatus, 'pending');

    // Pre-check filter honors D12 (tenantId + clientSignature.tokenId + isDeleted:false).
    const preFilter = spy.getPreFilter();
    assert.equal(preFilter._id, SHEET_ID);
    assert.equal(preFilter.tenantId, 'tenant-1');
    assert.equal(preFilter['clientSignature.tokenId'], TOKEN_ID);
    assert.equal(preFilter.isDeleted, false);

    // Atomic write filter carries the same D12 gate PLUS the empty-firmaFile
    // guard so a race with a concurrent late-sign resolves as SHEET_ALREADY_SIGNED.
    const updateFilter = spy.getUpdateFilter();
    assert.equal(updateFilter._id, SHEET_ID);
    assert.equal(updateFilter.tenantId, 'tenant-1');
    assert.equal(updateFilter['clientSignature.tokenId'], TOKEN_ID);
    assert.equal(updateFilter.isDeleted, false);
    assert.deepEqual(updateFilter.firmaFile, { $in: [null, ''] });

    // $set MUST touch firmaFile / personaRecibe / cargoRecibe / estado /
    // clientSignature.signedAt / pdfStatus and MUST NOT touch ip/userAgent
    // (spec "Late-sign preserves audit trail").
    const update = spy.getUpdate();
    const setUpdate = update.$set;
    assert.equal(setUpdate.firmaFile, 'https://cdn/firma-late.png');
    assert.equal(setUpdate.personaRecibe, 'Cliente Tardío');
    assert.equal(setUpdate.estado, 'Firmada');
    assert.equal(setUpdate.pdfStatus, 'pending');
    assert.ok(setUpdate['clientSignature.signedAt'] instanceof Date);
    assert.equal('clientSignature.ip' in setUpdate, false, 'ip must not be overwritten');
    assert.equal('clientSignature.userAgent' in setUpdate, false, 'userAgent must not be overwritten');
    assert.equal('clientSignature.signedBatchId' in setUpdate, false);
    assert.equal('clientSignature.contentHash' in setUpdate, false);
    assert.equal('clientSignature.tokenId' in setUpdate, false);
  });

  it('404 SHEET_NOT_FOUND when the sheet was signed under a different tokenId', async () => {
    // D12 gate is in the Mongoose filter — a mismatch returns nothing, no
    // existence leak.
    mockSheetLookup({ preSheet: null, updatedSheet: null });

    const stroke = await strokePngBase64();
    const req = {
      tenantId: 'tenant-1',
      tokenId: OTHER_TOKEN_ID,
      params: { sheetId: SHEET_ID },
      headers: {},
      body: { signature: { imagePng: stroke, signerName: 'Cliente' } },
    };
    let capturedErr = null;
    await clientPortalController.signExistingSheet(req, buildRes(), (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'SHEET_NOT_FOUND');
  });

  it('409 SHEET_ALREADY_SIGNED when firmaFile is already set (pre-check)', async () => {
    mockSheetLookup({
      preSheet: preSheetTemplate({ firmaFile: 'https://cdn/already-signed.png' }),
      updatedSheet: null,
    });

    const stroke = await strokePngBase64();
    const req = {
      tenantId: 'tenant-1',
      tokenId: TOKEN_ID,
      params: { sheetId: SHEET_ID },
      headers: {},
      body: { signature: { imagePng: stroke, signerName: 'Cliente' } },
    };
    let capturedErr = null;
    await clientPortalController.signExistingSheet(req, buildRes(), (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'SHEET_ALREADY_SIGNED');
  });

  it('409 SHEET_ALREADY_SIGNED under concurrent race (findOneAndUpdate returns null)', async () => {
    // Pre-check sees empty firmaFile, but by the time the atomic write
    // runs another late-sign has already won — findOneAndUpdate matches
    // zero docs and returns null. The endpoint must surface a 409 instead
    // of silently succeeding.
    mockSheetLookup({
      preSheet: preSheetTemplate(),
      updatedSheet: null,
    });
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma-late.png', storagePath: 'x' });

    const stroke = await strokePngBase64();
    const req = {
      tenantId: 'tenant-1',
      tokenId: TOKEN_ID,
      params: { sheetId: SHEET_ID },
      headers: {},
      body: { signature: { imagePng: stroke, signerName: 'Cliente' } },
    };
    let capturedErr = null;
    await clientPortalController.signExistingSheet(req, buildRes(), (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'SHEET_ALREADY_SIGNED');
  });

  it('400 INVALID_SIGNATURE_IMAGE when the PNG is blank', async () => {
    const blank = await blankPngBase64();
    const req = {
      body: { signature: { imagePng: blank, signerName: 'Cliente' } },
    };
    let capturedErr = null;
    await validate(clientPortalLateSignDto, 'body')(req, buildRes(), (err) => { capturedErr = err; });

    assert.ok(capturedErr, 'expected the DTO to reject a blank signature');
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'INVALID_SIGNATURE_IMAGE');
  });

  it('404 SHEET_NOT_FOUND when the sheet belongs to a different tenant', async () => {
    mockSheetLookup({ preSheet: null, updatedSheet: null });

    const stroke = await strokePngBase64();
    const req = {
      tenantId: 'tenant-2',
      tokenId: TOKEN_ID,
      params: { sheetId: SHEET_ID },
      headers: {},
      body: { signature: { imagePng: stroke, signerName: 'Cliente' } },
    };
    let capturedErr = null;
    await clientPortalController.signExistingSheet(req, buildRes(), (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'SHEET_NOT_FOUND');
  });

  it('preserves signedBatchId, contentHash, tokenId, ip, userAgent after late-sign (audit trail)', async () => {
    // The Late-sign spec explicitly lists ip and userAgent among fields
    // that MUST stay unchanged so signer-dispute investigations can trace
    // back to the ORIGINAL requester. This test asserts that by verifying
    // the $set payload never touches those five fields (and only refreshes
    // signedAt). The mock's post-update sheet keeps the original values,
    // simulating what findOneAndUpdate returns when the audit fields are
    // left alone.
    const stroke = await strokePngBase64();
    const spy = mockSheetLookup({
      preSheet: preSheetTemplate(),
      updatedSheet: updatedSheetTemplate(),
    });
    firebaseStorageService.uploadEvidencia = async () => ({ url: 'https://cdn/firma-late.png', storagePath: 'x' });

    const req = {
      tenantId: 'tenant-1',
      tokenId: TOKEN_ID,
      params: { sheetId: SHEET_ID },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'new-agent' },
      body: { signature: { imagePng: stroke, signerName: 'Cliente Tardío' } },
    };
    await clientPortalController.signExistingSheet(req, buildRes(), (err) => { if (err) throw err; });

    const setUpdate = spy.getUpdate().$set;
    // Only `signedAt` may be refreshed. Every other clientSignature.* field
    // must be absent from the $set so Mongo leaves it untouched.
    assert.equal('clientSignature.signedBatchId' in setUpdate, false);
    assert.equal('clientSignature.contentHash' in setUpdate, false);
    assert.equal('clientSignature.tokenId' in setUpdate, false);
    assert.equal('clientSignature.ip' in setUpdate, false);
    assert.equal('clientSignature.userAgent' in setUpdate, false);
    assert.ok(setUpdate['clientSignature.signedAt'] instanceof Date);
    assert.notEqual(
      setUpdate['clientSignature.signedAt'].getTime(),
      new Date('2026-08-01T00:00:00.000Z').getTime(),
      'signedAt must be refreshed to the late-sign moment'
    );
  });
});
