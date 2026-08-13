/**
 * tests/integration/shareSignedSheet.routes.test.js
 */
import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { OT } from '../../src/models/ot.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { sheetWorkController } from '../../src/controllers/sheetwork.controller.js';
import { sheetWorkDownloadTokenService } from '../../src/services/sheetWorkDownloadToken.service.js';
import { emailService } from '../../src/services/external/email.service.js';
import { env } from '../../src/config/env.js';

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

const originalNotifs = env.NOTIFICATIONS_ENABLED;

describe('POST /api/v1/sheetwork/:sheetId/share', () => {
  afterEach(() => {
    delete SheetWork.findOne;
    delete SheetWork.updateOne;
    delete Customer.updateOne;
    delete Customer.findOne;
    delete OT.findById;
    delete Tenant.findOne;
    delete sheetWorkDownloadTokenService.createForSheet;
    delete emailService.sendSheetShareDownloadEmail;
    env.NOTIFICATIONS_ENABLED = originalNotifs;
  });

  it('rejects 409 SHEET_NOT_SIGNED when the sheet is not Firmada', async () => {
    SheetWork.findOne = () => Promise.resolve({
      _id: SHEET_ID, tenantId: TENANT, estado: 'EnviadaAFirmar', firmaFile: null,
    });
    const req = { tenantId: TENANT, user: { userId: USER_ID }, params: { sheetId: SHEET_ID }, body: { email: 'a@b.com' } };
    let capturedErr = null;
    await sheetWorkController.shareSignedSheet(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'SHEET_NOT_SIGNED');
  });

  it('happy path: creates token, updates shareHistory, calls pushCorreoUsado, returns emailSent flag', async () => {
    env.NOTIFICATIONS_ENABLED = true;
    SheetWork.findOne = () => Promise.resolve({
      _id: SHEET_ID, tenantId: TENANT, estado: 'Firmada', firmaFile: 'https://firebase/f.png',
      otId: OT_ID, clienteId: CLIENT_ID, numeroHoja: 'OT-1-1',
    });
    let historyUpdate = null;
    SheetWork.updateOne = async (_f, u) => { historyUpdate = u; };
    Customer.updateOne = async () => ({});
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ correousados: [] }) }) });
    OT.findById = () => ({ select: () => ({ lean: () => Promise.resolve({ Consecutivo: 'OT-2026-001' }) }) });
    Tenant.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ name: 'Test Tenant' }) }) });
    sheetWorkDownloadTokenService.createForSheet = async ({ email, allowReports }) => ({
      _id: 'tok-1',
      token: 'plain-token',
      expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      downloadsAllowed: 3,
      allowReports: Boolean(allowReports),
      reportDownloadsAllowed: allowReports ? 2 : 0,
    });
    let sendCalled = false;
    emailService.sendSheetShareDownloadEmail = async () => { sendCalled = true; return { sent: true }; };

    const req = {
      tenantId: TENANT, user: { userId: USER_ID },
      params: { sheetId: SHEET_ID }, body: { email: 'Client@Example.COM', allowReports: true },
    };
    const res = buildRes();
    await sheetWorkController.shareSignedSheet(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.token, 'plain-token');
    assert.equal(res.body.data.allowReports, true);
    assert.equal(res.body.data.emailSent, true);
    assert.equal(sendCalled, true);
    assert.equal(historyUpdate.$set['shareHistory.lastEmail'], 'client@example.com');
    assert.equal(historyUpdate.$inc['shareHistory.sendCount'], 1);
  });

  it('emailSent:false when NOTIFICATIONS_ENABLED=false, but still records the attempt', async () => {
    env.NOTIFICATIONS_ENABLED = false;
    SheetWork.findOne = () => Promise.resolve({
      _id: SHEET_ID, tenantId: TENANT, estado: 'Firmada', firmaFile: 'https://firebase/f.png',
      otId: OT_ID, clienteId: CLIENT_ID, numeroHoja: 'OT-1-1',
    });
    let historyUpdate = null;
    SheetWork.updateOne = async (_f, u) => { historyUpdate = u; };
    Customer.updateOne = async () => ({});
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ correousados: [] }) }) });
    sheetWorkDownloadTokenService.createForSheet = async () => ({
      _id: 'tok', token: 'p', expiresAt: new Date(), downloadsAllowed: 3, allowReports: false, reportDownloadsAllowed: 0,
    });

    const req = { tenantId: TENANT, user: { userId: USER_ID }, params: { sheetId: SHEET_ID }, body: { email: 'a@b.com' } };
    const res = buildRes();
    await sheetWorkController.shareSignedSheet(req, res, (err) => { if (err) throw err; });

    assert.equal(res.body.data.emailSent, false);
    // Attempt recorded regardless of transport outcome
    assert.equal(historyUpdate.$inc['shareHistory.sendCount'], 1);
  });
});
