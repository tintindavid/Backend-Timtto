/**
 * tests/middlewares/resolveClientToken.middleware.test.js
 *
 * Behavior tests for resolveClientToken — follows the same pattern as
 * tests/middlewares/tenant.middleware.test.js: a minimal fake req/res/next
 * triple, ClientAccessToken statics monkey-patched per test (no real DB).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';
import { resolveClientToken } from '../../src/middlewares/resolveClientToken.middleware.js';

function buildContext(token) {
  const req = { params: { token } };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[name] = value; return this; },
  };
  let nextCalled = false;
  let nextError = null;
  const next = (err) => {
    if (err) nextError = err;
    else nextCalled = true;
  };
  return {
    req,
    res,
    next,
    wasNextCalled: () => nextCalled,
    getNextError: () => nextError,
  };
}

describe('resolveClientToken middleware', () => {
  afterEach(() => {
    delete ClientAccessToken.findOne;
    delete ClientAccessToken.updateOne;
  });

  it('responds 404 { error: "token_not_found" } for an unknown token, and does not call next()', async () => {
    let findOneCalledWith = null;
    ClientAccessToken.findOne = (filter) => {
      findOneCalledWith = filter;
      return { lean: () => Promise.resolve(null) };
    };

    const { req, res, next, wasNextCalled } = buildContext('unknown-token');
    await resolveClientToken(req, res, next);

    assert.deepEqual(findOneCalledWith, { token: 'unknown-token' });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'token_not_found' });
    assert.equal(wasNextCalled(), false);
  });

  it('responds 404 without a DB lookup when req.params.token is missing', async () => {
    let called = false;
    ClientAccessToken.findOne = () => { called = true; return { lean: () => Promise.resolve(null) }; };

    const { req, res, next, wasNextCalled } = buildContext(undefined);
    await resolveClientToken(req, res, next);

    assert.equal(called, false);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'token_not_found' });
    assert.equal(wasNextCalled(), false);
  });

  it('responds 410 { error: "token_revoked", revokedAt } for a revoked token, and does not call next()', async () => {
    const revokedAt = new Date('2026-01-01T00:00:00.000Z');
    ClientAccessToken.findOne = () => ({
      lean: () => Promise.resolve({ _id: 'tok-1', status: 'revoked', revokedAt }),
    });

    const { req, res, next, wasNextCalled } = buildContext('revoked-token');
    await resolveClientToken(req, res, next);

    assert.equal(res.statusCode, 410);
    assert.equal(res.body.error, 'token_revoked');
    assert.equal(res.body.revokedAt, revokedAt);
    assert.equal(wasNextCalled(), false);
  });

  it('attaches req.tenantId/clienteId/otIds/tokenId/clientAccessToken and calls next() for an active token', async () => {
    ClientAccessToken.findOne = () => ({
      lean: () => Promise.resolve({
        _id: 'tok-1',
        tenantId: 'tenant-1',
        clienteId: 'cliente-1',
        otIds: ['ot-1', 'ot-2'],
        status: 'active',
      }),
    });
    ClientAccessToken.updateOne = () => ({ exec: () => Promise.resolve() });

    const { req, res, next, wasNextCalled, getNextError } = buildContext('active-token');
    await resolveClientToken(req, res, next);

    assert.equal(wasNextCalled(), true);
    assert.equal(getNextError(), null);
    assert.equal(req.tenantId, 'tenant-1');
    assert.equal(req.clienteId, 'cliente-1');
    assert.deepEqual(req.otIds, ['ot-1', 'ot-2']);
    assert.equal(req.tokenId, 'tok-1');
    assert.deepEqual(req.clientAccessToken, { tokenId: 'tok-1', clienteId: 'cliente-1', otIds: ['ot-1', 'ot-2'] });
  });

  it('fires the access-counter update without awaiting it — response is not blocked by a slow write', async () => {
    ClientAccessToken.findOne = () => ({
      lean: () => Promise.resolve({
        _id: 'tok-1',
        tenantId: 'tenant-1',
        clienteId: 'cliente-1',
        otIds: ['ot-1'],
        status: 'active',
      }),
    });

    let updateOneCalledWith = null;
    // A never-resolving promise simulates a slow write. If the middleware
    // awaited this, the test itself would hang/timeout.
    ClientAccessToken.updateOne = (filter, update) => {
      updateOneCalledWith = { filter, update };
      return { exec: () => new Promise(() => {}) };
    };

    const { req, res, next, wasNextCalled } = buildContext('active-token');
    await resolveClientToken(req, res, next);

    assert.equal(wasNextCalled(), true, 'next() must be called even though the counter write never resolves');
    assert.ok(updateOneCalledWith, 'updateOne must have been invoked (best-effort)');
    assert.deepEqual(updateOneCalledWith.filter, { _id: 'tok-1' });
    assert.deepEqual(updateOneCalledWith.update.$inc, { accessCount: 1 });
    assert.ok(updateOneCalledWith.update.$set.lastAccessedAt instanceof Date);
  });

  it('forwards unexpected errors to next(err) instead of throwing', async () => {
    const boom = new Error('mongo down');
    ClientAccessToken.findOne = () => { throw boom; };

    const { req, res, next, getNextError } = buildContext('any-token');
    await resolveClientToken(req, res, next);

    assert.equal(getNextError(), boom);
  });
});
