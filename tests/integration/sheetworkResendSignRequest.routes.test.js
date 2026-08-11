/**
 * tests/integration/sheetworkResendSignRequest.routes.test.js
 *
 * DB-free tests for POST /api/v1/sheetwork/:sheetId/resend-sign-request.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { OT } from '../../src/models/ot.model.js';
import { User } from '../../src/models/user.model.js';
import { SheetWorkSignToken } from '../../src/models/sheetWorkSignToken.model.js';
import { sheetWorkController } from '../../src/controllers/sheetwork.controller.js';
import { sheetWorkSignTokenService } from '../../src/services/sheetWorkSignToken.service.js';
import { emailService } from '../../src/services/external/email.service.js';

function buildRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
}

const TENANT = 'tenant-a';
const SHEET_ID = '507f1f77bcf86cd799439030';
const OT_ID = '507f1f77bcf86cd799439010';
const CLIENT_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439099';
const EXISTING_TOK_ID = '507f1f77bcf86cd799439040';

describe('POST /api/v1/sheetwork/:sheetId/resend-sign-request', () => {
  afterEach(() => {
    delete SheetWork.findOne;
    delete SheetWork.updateOne;
    delete Customer.updateOne;
    delete Customer.findOne;
    delete OT.findOne;
    delete User.findById;
    delete SheetWorkSignToken.findOne;
    delete SheetWorkSignToken.updateOne;
    delete sheetWorkSignTokenService.createForSheet;
    delete sheetWorkSignTokenService.incrementResendCount;
    delete sheetWorkSignTokenService.updateEmail;
    delete emailService.sendSheetSignRequestEmail;
  });

  it('reuses the active token when unexpired', async () => {
    SheetWork.findOne = () => Promise.resolve({
      _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, clienteId: CLIENT_ID,
      estado: 'EnviadaAFirmar', numeroHoja: 'OT-1-1',
      remoteSignRequest: { tokenId: EXISTING_TOK_ID, email: 'a@b.com' },
    });
    SheetWork.updateOne = async () => ({});
    OT.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ Consecutivo: 'OT-1', ClienteId: CLIENT_ID }) }) });
    Customer.updateOne = async () => ({});
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ correousados: ['a@b.com'] }) }) });
    User.findById = () => ({ select: () => ({ lean: () => Promise.resolve({ fullName: 'Ana' }) }) });

    SheetWorkSignToken.findOne = async () => ({
      _id: EXISTING_TOK_ID,
      status: 'active',
      expiresAt: new Date(Date.now() + 5 * 24 * 3600 * 1000),
      email: 'a@b.com',
      token: 'orig-token',
    });
    let incrementCalled = false;
    sheetWorkSignTokenService.incrementResendCount = async () => { incrementCalled = true; };
    sheetWorkSignTokenService.updateEmail = async () => {};
    let createCalled = false;
    sheetWorkSignTokenService.createForSheet = async () => { createCalled = true; return {}; };
    emailService.sendSheetSignRequestEmail = async () => ({ sent: true });

    const req = { tenantId: TENANT, user: { userId: USER_ID }, params: { sheetId: SHEET_ID }, body: { email: 'a@b.com' } };
    const res = buildRes();
    await sheetWorkController.resendSignRequest(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.tokenId, EXISTING_TOK_ID);
    assert.equal(incrementCalled, true);
    assert.equal(createCalled, false, 'should not create a new token when the existing one is valid');
  });

  it('creates a new token when the existing one is expired', async () => {
    SheetWork.findOne = () => Promise.resolve({
      _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, clienteId: CLIENT_ID,
      estado: 'EnviadaAFirmar', numeroHoja: 'OT-1-1',
      remoteSignRequest: { tokenId: EXISTING_TOK_ID, email: 'a@b.com' },
    });
    SheetWork.updateOne = async () => ({});
    OT.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ Consecutivo: 'OT-1', ClienteId: CLIENT_ID }) }) });
    Customer.updateOne = async () => ({});
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ correousados: [] }) }) });
    User.findById = () => ({ select: () => ({ lean: () => Promise.resolve(null) }) });

    SheetWorkSignToken.findOne = async () => ({
      _id: EXISTING_TOK_ID,
      status: 'expired',
      expiresAt: new Date(Date.now() - 24 * 3600 * 1000),
      email: 'a@b.com',
      token: 'old',
    });
    let createCalled = false;
    sheetWorkSignTokenService.createForSheet = async () => {
      createCalled = true;
      return { _id: 'new-tok', token: 'new-token', expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) };
    };
    emailService.sendSheetSignRequestEmail = async () => ({ sent: true });

    const req = { tenantId: TENANT, user: { userId: USER_ID }, params: { sheetId: SHEET_ID }, body: { email: 'a@b.com' } };
    const res = buildRes();
    await sheetWorkController.resendSignRequest(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(createCalled, true);
    assert.equal(res.body.data.tokenId, 'new-tok');
  });

  it('rejects with 409 SHEET_ALREADY_SIGNED when the sheet is Firmada', async () => {
    SheetWork.findOne = () => Promise.resolve({
      _id: SHEET_ID, tenantId: TENANT, estado: 'Firmada',
    });
    const req = { tenantId: TENANT, user: { userId: USER_ID }, params: { sheetId: SHEET_ID }, body: { email: 'a@b.com' } };
    let capturedErr = null;
    await sheetWorkController.resendSignRequest(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'SHEET_ALREADY_SIGNED');
  });

  it('adds the new email to correousados when it differs from the previous one', async () => {
    SheetWork.findOne = () => Promise.resolve({
      _id: SHEET_ID, tenantId: TENANT, otId: OT_ID, clienteId: CLIENT_ID,
      estado: 'EnviadaAFirmar', numeroHoja: 'OT-1-1',
      remoteSignRequest: { tokenId: EXISTING_TOK_ID, email: 'old@example.com' },
    });
    SheetWork.updateOne = async () => ({});
    OT.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ Consecutivo: 'OT-1', ClienteId: CLIENT_ID }) }) });
    let customerUpdate = null;
    Customer.updateOne = async (_f, update) => { customerUpdate = update; };
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ correousados: ['old@example.com'] }) }) });
    User.findById = () => ({ select: () => ({ lean: () => Promise.resolve(null) }) });
    SheetWorkSignToken.findOne = async () => ({
      _id: EXISTING_TOK_ID, status: 'active', expiresAt: new Date(Date.now() + 60_000), email: 'old@example.com', token: 't',
    });
    sheetWorkSignTokenService.updateEmail = async () => {};
    sheetWorkSignTokenService.incrementResendCount = async () => {};
    emailService.sendSheetSignRequestEmail = async () => ({ sent: true });

    const req = { tenantId: TENANT, user: { userId: USER_ID }, params: { sheetId: SHEET_ID }, body: { email: 'new@example.com' } };
    await sheetWorkController.resendSignRequest(req, buildRes(), (err) => { if (err) throw err; });
    assert.deepEqual(customerUpdate.$addToSet, { correousados: 'new@example.com' });
  });
});
