/**
 * tests/integration/sheetworkRemoteSignRequest.routes.test.js
 *
 * DB-free tests for POST /api/v1/sheetwork/remote-sign-request.
 * Mocks Mongoose models + the email service at the boundary.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { OT } from '../../src/models/ot.model.js';
import { User } from '../../src/models/user.model.js';
import { SheetWorkSignToken } from '../../src/models/sheetWorkSignToken.model.js';
import { sheetWorkController } from '../../src/controllers/sheetwork.controller.js';
import { emailService } from '../../src/services/external/email.service.js';
import { sheetWorkSignTokenService } from '../../src/services/sheetWorkSignToken.service.js';

function buildRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
}

const TENANT = 'tenant-a';
const OT_ID = '507f1f77bcf86cd799439010';
const CLIENT_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439099';
const REPORT_ID = '507f1f77bcf86cd799439021';

describe('POST /api/v1/sheetwork/remote-sign-request', () => {
  afterEach(() => {
    delete OT.findOne;
    delete OT.countDocuments;
    delete SheetWork.create;
    delete SheetWork.updateOne;
    delete SheetWork.countDocuments;
    delete SheetWork.deleteOne;
    delete Customer.updateOne;
    delete Customer.findOne;
    delete User.findById;
    delete SheetWorkSignToken.findOne;
    delete SheetWorkSignToken.findOneAndUpdate;
    delete sheetWorkSignTokenService.createForSheet;
    delete emailService.sendSheetSignRequestEmail;
  });

  function stubHappyPath({ sendResult = { sent: true } } = {}) {
    OT.findOne = () => {
      const doc = { _id: OT_ID, tenantId: TENANT, ClienteId: CLIENT_ID, Consecutivo: 'OT-2026-001' };
      const chain = { select: () => chain, lean: () => Promise.resolve(doc) };
      return chain;
    };
    SheetWork.countDocuments = async () => 0;
    SheetWork.create = async (data) => ({ _id: 'sheet-1', ...data, toObject() { return { _id: 'sheet-1', ...data }; } });
    SheetWork.updateOne = async () => ({});
    Customer.updateOne = async () => ({});
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ correousados: [] }) }) });
    User.findById = () => ({
      select: () => ({
        lean: () => Promise.resolve({
          fullName: 'Ana Tester',
          role: 'admin',
          fileFirma: 'https://firebase/user-firma.png',
          isDeleted: false,
        }),
      }),
    });
    sheetWorkSignTokenService.createForSheet = async ({ email }) => ({
      _id: 'tok-1',
      token: 'nanoid-32-chars-xxxxxxxxxxxxxxxx',
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      email,
    });
    emailService.sendSheetSignRequestEmail = async () => sendResult;
  }

  it('creates a sheet in EnviadaAFirmar, generates a token, returns 201 with emailSent flag', async () => {
    stubHappyPath();
    const req = {
      tenantId: TENANT,
      user: { userId: USER_ID },
      body: { otId: OT_ID, reportIds: [REPORT_ID], email: 'Client@Example.com', message: 'Please sign' },
    };
    const res = buildRes();
    await sheetWorkController.remoteSignRequest(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.sheetId, 'sheet-1');
    assert.equal(res.body.data.tokenId, 'tok-1');
    assert.ok(res.body.data.expiresAt);
  });

  it('lowercases the email and stores it on the sheet', async () => {
    let createdData = null;
    OT.findOne = () => {
      const doc = { _id: OT_ID, tenantId: TENANT, ClienteId: CLIENT_ID, Consecutivo: 'OT-1' };
      const chain = { select: () => chain, lean: () => Promise.resolve(doc) };
      return chain;
    };
    SheetWork.countDocuments = async () => 0;
    SheetWork.create = async (data) => { createdData = data; return { _id: 'sheet-2', ...data }; };
    SheetWork.updateOne = async () => ({});
    Customer.updateOne = async () => ({});
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ correousados: [] }) }) });
    User.findById = () => ({
      select: () => ({
        lean: () => Promise.resolve({
          fullName: 'Ana Tester',
          role: 'admin',
          fileFirma: 'https://firebase/user-firma.png',
          isDeleted: false,
        }),
      }),
    });
    sheetWorkSignTokenService.createForSheet = async () => ({ _id: 'tok', token: 't', expiresAt: new Date() });

    const req = { tenantId: TENANT, user: { userId: USER_ID }, body: { otId: OT_ID, reportIds: [REPORT_ID], email: 'MixedCase@Example.COM' } };
    await sheetWorkController.remoteSignRequest(req, buildRes(), (err) => { if (err) throw err; });

    assert.equal(createdData.estado, 'EnviadaAFirmar');
    assert.equal(createdData.remoteSignRequest.email, 'mixedcase@example.com');
    // The requester's signature + name + role are baked into the sheet so
    // the client's preview and the final PDF both render them.
    assert.equal(createdData.firmaResponsableFile, 'https://firebase/user-firma.png');
    assert.equal(createdData.fullNameResponsable, 'Ana Tester');
    assert.equal(createdData.cargoResponsable, 'admin');
  });

  it('adds the recipient email to Customer.correousados via $addToSet', async () => {
    let customerUpdate = null;
    OT.findOne = () => {
      const doc = { _id: OT_ID, tenantId: TENANT, ClienteId: CLIENT_ID, Consecutivo: 'OT-1' };
      const chain = { select: () => chain, lean: () => Promise.resolve(doc) };
      return chain;
    };
    SheetWork.countDocuments = async () => 0;
    SheetWork.create = async (d) => ({ _id: 's', ...d });
    SheetWork.updateOne = async () => ({});
    Customer.updateOne = async (_f, update) => { customerUpdate = update; };
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ correousados: [] }) }) });
    User.findById = () => ({
      select: () => ({
        lean: () => Promise.resolve({
          fullName: 'Ana Tester',
          role: 'admin',
          fileFirma: 'https://firebase/user-firma.png',
          isDeleted: false,
        }),
      }),
    });
    sheetWorkSignTokenService.createForSheet = async () => ({ _id: 't', token: 't', expiresAt: new Date() });

    const req = { tenantId: TENANT, user: { userId: USER_ID }, body: { otId: OT_ID, reportIds: [REPORT_ID], email: 'a@b.com' } };
    await sheetWorkController.remoteSignRequest(req, buildRes(), (err) => { if (err) throw err; });

    assert.deepEqual(customerUpdate.$addToSet, { correousados: 'a@b.com' });
  });

  it('returns 404 OT_NOT_FOUND when the OT is not visible for this tenant', async () => {
    OT.findOne = () => ({ lean: () => Promise.resolve(null) });
    let capturedErr = null;
    const req = { tenantId: TENANT, user: { userId: USER_ID }, body: { otId: OT_ID, reportIds: [REPORT_ID], email: 'a@b.com' } };
    await sheetWorkController.remoteSignRequest(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'OT_NOT_FOUND');
  });

  it('returns 409 USER_HAS_NO_SIGNATURE when the requester has no fileFirma', async () => {
    OT.findOne = () => {
      const doc = { _id: OT_ID, tenantId: TENANT, ClienteId: CLIENT_ID, Consecutivo: 'OT-1' };
      const chain = { select: () => chain, lean: () => Promise.resolve(doc) };
      return chain;
    };
    User.findById = () => ({
      select: () => ({
        lean: () => Promise.resolve({
          fullName: 'No-Firma User',
          role: 'admin',
          fileFirma: '',
          isDeleted: false,
        }),
      }),
    });
    let sheetCreated = false;
    SheetWork.create = async () => { sheetCreated = true; return { _id: 'x' }; };

    const req = { tenantId: TENANT, user: { userId: USER_ID }, body: { otId: OT_ID, reportIds: [REPORT_ID], email: 'a@b.com' } };
    let capturedErr = null;
    await sheetWorkController.remoteSignRequest(req, buildRes(), (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'USER_HAS_NO_SIGNATURE');
    assert.equal(sheetCreated, false, 'must fail-fast before creating any sheet');
  });

  it('returns 409 USER_HAS_NO_SIGNATURE when the requester user is soft-deleted', async () => {
    OT.findOne = () => {
      const doc = { _id: OT_ID, tenantId: TENANT, ClienteId: CLIENT_ID, Consecutivo: 'OT-1' };
      const chain = { select: () => chain, lean: () => Promise.resolve(doc) };
      return chain;
    };
    User.findById = () => ({
      select: () => ({
        lean: () => Promise.resolve({
          fullName: 'Deleted',
          role: 'admin',
          fileFirma: 'https://firebase/x.png',
          isDeleted: true,
        }),
      }),
    });

    const req = { tenantId: TENANT, user: { userId: USER_ID }, body: { otId: OT_ID, reportIds: [REPORT_ID], email: 'a@b.com' } };
    let capturedErr = null;
    await sheetWorkController.remoteSignRequest(req, buildRes(), (err) => { capturedErr = err; });

    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'USER_HAS_NO_SIGNATURE');
  });
});
