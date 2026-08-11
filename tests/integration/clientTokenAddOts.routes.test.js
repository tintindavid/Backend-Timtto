/**
 * tests/integration/clientTokenAddOts.routes.test.js
 *
 * DB-free tests for PATCH /api/v1/client-tokens/:id/ots.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';
import { OT } from '../../src/models/ot.model.js';
import { clientAccessTokenController } from '../../src/controllers/clientAccessToken.controller.js';
import { clientAccessTokenService } from '../../src/services/clientAccessToken.service.js';

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
const OT_EXISTING = '507f1f77bcf86cd799439101';
const OT_NEW_1 = '507f1f77bcf86cd799439102';
const OT_NEW_2 = '507f1f77bcf86cd799439103';
const OT_OTHER_CLIENT = '507f1f77bcf86cd799439104';

describe('PATCH /api/v1/client-tokens/:id/ots', () => {
  afterEach(() => {
    delete ClientAccessToken.findOne;
    delete ClientAccessToken.updateOne;
    delete OT.find;
    delete clientAccessTokenService.getById;
  });

  it('appends new OTs and returns the populated token', async () => {
    ClientAccessToken.findOne = () => Promise.resolve({
      _id: TOKEN_ID,
      tenantId: TENANT,
      clienteId: CLIENT_ID,
      status: 'active',
      otIds: [OT_EXISTING],
    });
    OT.find = () => ({
      select: () => ({
        lean: () => Promise.resolve([
          { _id: OT_NEW_1, ClienteId: CLIENT_ID },
          { _id: OT_NEW_2, ClienteId: CLIENT_ID },
        ]),
      }),
    });
    let capturedUpdate = null;
    ClientAccessToken.updateOne = async (_filter, update) => { capturedUpdate = update; };
    clientAccessTokenService.getById = async () => ({
      _id: TOKEN_ID,
      otIds: [
        { _id: OT_EXISTING, Consecutivo: 'OT-1' },
        { _id: OT_NEW_1, Consecutivo: 'OT-2' },
        { _id: OT_NEW_2, Consecutivo: 'OT-3' },
      ],
    });

    const req = {
      tenantId: TENANT,
      params: { id: TOKEN_ID },
      body: { otIds: [OT_NEW_1, OT_NEW_2] },
    };
    const res = buildRes();
    await clientAccessTokenController.addOts(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(capturedUpdate.$addToSet.otIds.$each, [OT_NEW_1, OT_NEW_2]);
    assert.equal(res.body.data.otIds.length, 3);
  });

  it('is a no-op when every submitted OT is already in the token', async () => {
    ClientAccessToken.findOne = () => Promise.resolve({
      _id: TOKEN_ID,
      tenantId: TENANT,
      clienteId: CLIENT_ID,
      status: 'active',
      otIds: [OT_EXISTING, OT_NEW_1],
    });
    OT.find = () => ({
      select: () => ({
        lean: () => Promise.resolve([
          { _id: OT_EXISTING, ClienteId: CLIENT_ID },
          { _id: OT_NEW_1, ClienteId: CLIENT_ID },
        ]),
      }),
    });
    let updateCalled = false;
    ClientAccessToken.updateOne = async () => { updateCalled = true; };
    clientAccessTokenService.getById = async () => ({ _id: TOKEN_ID, otIds: [] });

    const req = { tenantId: TENANT, params: { id: TOKEN_ID }, body: { otIds: [OT_EXISTING, OT_NEW_1] } };
    await clientAccessTokenController.addOts(req, buildRes(), (err) => { if (err) throw err; });

    assert.equal(updateCalled, false, 'no DB write when every requested OT is already present');
  });

  it('rejects OT belonging to a different customer with 400 OT_CLIENT_MISMATCH', async () => {
    ClientAccessToken.findOne = () => Promise.resolve({
      _id: TOKEN_ID,
      tenantId: TENANT,
      clienteId: CLIENT_ID,
      status: 'active',
      otIds: [OT_EXISTING],
    });
    OT.find = () => ({
      select: () => ({
        lean: () => Promise.resolve([{ _id: OT_OTHER_CLIENT, ClienteId: 'different-client' }]),
      }),
    });

    const req = { tenantId: TENANT, params: { id: TOKEN_ID }, body: { otIds: [OT_OTHER_CLIENT] } };
    let capturedErr = null;
    await clientAccessTokenController.addOts(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'OT_CLIENT_MISMATCH');
  });

  it('rejects missing OT with 400 OT_NOT_AVAILABLE', async () => {
    ClientAccessToken.findOne = () => Promise.resolve({
      _id: TOKEN_ID,
      tenantId: TENANT,
      clienteId: CLIENT_ID,
      status: 'active',
      otIds: [],
    });
    OT.find = () => ({
      select: () => ({
        lean: () => Promise.resolve([]),  // length mismatch (requested 1, got 0)
      }),
    });

    const req = { tenantId: TENANT, params: { id: TOKEN_ID }, body: { otIds: [OT_NEW_1] } };
    let capturedErr = null;
    await clientAccessTokenController.addOts(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 400);
    assert.equal(capturedErr.code, 'OT_NOT_AVAILABLE');
  });

  it('rejects a revoked token with 409 TOKEN_REVOKED', async () => {
    ClientAccessToken.findOne = () => Promise.resolve({
      _id: TOKEN_ID,
      tenantId: TENANT,
      clienteId: CLIENT_ID,
      status: 'revoked',
      otIds: [],
    });

    const req = { tenantId: TENANT, params: { id: TOKEN_ID }, body: { otIds: [OT_NEW_1] } };
    let capturedErr = null;
    await clientAccessTokenController.addOts(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 409);
    assert.equal(capturedErr.code, 'TOKEN_REVOKED');
  });

  it('returns 404 NOT_FOUND for a cross-tenant / missing token', async () => {
    ClientAccessToken.findOne = () => Promise.resolve(null);
    const req = { tenantId: TENANT, params: { id: TOKEN_ID }, body: { otIds: [OT_NEW_1] } };
    let capturedErr = null;
    await clientAccessTokenController.addOts(req, buildRes(), (err) => { capturedErr = err; });
    assert.equal(capturedErr.statusCode, 404);
    assert.equal(capturedErr.code, 'NOT_FOUND');
  });
});
