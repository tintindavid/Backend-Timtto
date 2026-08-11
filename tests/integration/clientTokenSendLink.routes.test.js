/**
 * tests/integration/clientTokenSendLink.routes.test.js
 *
 * DB-free tests for POST /api/v1/client-tokens/:id/send.
 */
import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { User } from '../../src/models/user.model.js';
import { clientAccessTokenController } from '../../src/controllers/clientAccessToken.controller.js';
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
const TOKEN_ID = '507f1f77bcf86cd799439501';
const CLIENT_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439099';

const originalNotifs = env.NOTIFICATIONS_ENABLED;

describe('POST /api/v1/client-tokens/:id/send', () => {
  afterEach(() => {
    delete ClientAccessToken.findOne;
    delete ClientAccessToken.updateOne;
    delete Customer.findOne;
    delete Customer.updateOne;
    delete User.findById;
    delete emailService.sendClientPortalLinkEmail;
    env.NOTIFICATIONS_ENABLED = originalNotifs;
  });

  it('sends the link, records emailHistory, returns emailSent: true', async () => {
    env.NOTIFICATIONS_ENABLED = true;
    ClientAccessToken.findOne = () => Promise.resolve({
      _id: TOKEN_ID, tenantId: TENANT, clienteId: CLIENT_ID, status: 'active', token: 'plain-token',
    });
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ Razonsocial: 'Cliente Uno' }) }) });
    User.findById = () => ({ select: () => ({ lean: () => Promise.resolve({ fullName: 'Ana Tester' }) }) });
    let sendArgs = null;
    emailService.sendClientPortalLinkEmail = async (args) => { sendArgs = args; return { sent: true }; };
    let historyUpdate = null;
    ClientAccessToken.updateOne = async (_filter, update) => { historyUpdate = update; };
    Customer.updateOne = async () => ({});
    // pushCorreoUsado's follow-up findOne for cap check
    // Customer.findOne was overridden above with select().lean() chain — the
    // util chain uses `.select('correousados').lean()` which works with the
    // same mock, returning `{ Razonsocial: ... }` (no correousados) — treated
    // as length 0, no truncation.

    const req = {
      tenantId: TENANT,
      user: { userId: USER_ID },
      params: { id: TOKEN_ID },
      body: { email: 'Client@Example.COM' },
    };
    const res = buildRes();
    await clientAccessTokenController.sendLink(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.emailSent, true);
    assert.equal(sendArgs.to, 'client@example.com');
    assert.match(sendArgs.portalUrl, /\/portal\/plain-token$/);
    assert.equal(historyUpdate.$set['emailHistory.lastEmail'], 'client@example.com');
    assert.equal(historyUpdate.$set['emailHistory.lastSentBy'], USER_ID);
    assert.equal(historyUpdate.$inc['emailHistory.sendCount'], 1);
  });

  it('still records the attempt and returns emailSent: false when notifications are disabled', async () => {
    env.NOTIFICATIONS_ENABLED = false;
    ClientAccessToken.findOne = () => Promise.resolve({
      _id: TOKEN_ID, tenantId: TENANT, clienteId: CLIENT_ID, status: 'active', token: 'plain-token',
    });
    Customer.findOne = () => ({ select: () => ({ lean: () => Promise.resolve({ Razonsocial: 'X' }) }) });
    User.findById = () => ({ select: () => ({ lean: () => Promise.resolve(null) }) });
    let sendCalled = false;
    emailService.sendClientPortalLinkEmail = async () => { sendCalled = true; return { sent: false, skipped: true }; };
    let historyUpdate = null;
    ClientAccessToken.updateOne = async (_filter, update) => { historyUpdate = update; };
    Customer.updateOne = async () => ({});

    const req = {
      tenantId: TENANT, user: { userId: USER_ID },
      params: { id: TOKEN_ID }, body: { email: 'a@b.com' },
    };
    const res = buildRes();
    await clientAccessTokenController.sendLink(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.emailSent, false);
    assert.equal(sendCalled, false, 'skips Resend when NOTIFICATIONS_ENABLED=false');
    // Attempt still recorded (D6).
    assert.equal(historyUpdate.$set['emailHistory.lastEmail'], 'a@b.com');
    assert.equal(historyUpdate.$inc['emailHistory.sendCount'], 1);
  });

  it('rejects a revoked token with 409 TOKEN_REVOKED', async () => {
    ClientAccessToken.findOne = () => Promise.resolve({
      _id: TOKEN_ID, tenantId: TENANT, clienteId: CLIENT_ID, status: 'revoked', token: 't',
    });
    const req = {
      tenantId: TENANT, user: { userId: USER_ID },
      params: { id: TOKEN_ID }, body: { email: 'a@b.com' },
    };
    let capturedErr = null;
    await clientAccessTokenController.sendLink(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'TOKEN_REVOKED');
  });
});
