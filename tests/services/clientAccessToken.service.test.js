/**
 * tests/services/clientAccessToken.service.test.js
 *
 * Unit tests for ClientAccessTokenService. Follows the project convention
 * (see tests/isolation/*.test.js, tests/auth.me.test.js): no real MongoDB
 * connection — Mongoose model statics are monkey-patched per test and
 * restored in afterEach.
 *
 * `ClientAccessToken.prototype.save` is stubbed to run schema validation
 * (so the pre('validate') cross-check still executes) without attempting an
 * actual DB round-trip, matching the "no DB in unit tests" convention used
 * throughout this repo.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { clientAccessTokenService } from '../../src/services/clientAccessToken.service.js';
import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';
import { User } from '../../src/models/user.model.js';
import { OT } from '../../src/models/ot.model.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const TENANT = 'tenant-1';
const USER_ID = '507f1f77bcf86cd799439014';
const USER_ID_2 = '507f1f77bcf86cd799439015';
const CLIENTE_ID = '507f1f77bcf86cd799439011';
const OT_ID_1 = '507f1f77bcf86cd799439012';
const OT_ID_2 = '507f1f77bcf86cd799439013';
const TOK_ID = '507f1f77bcf86cd799439016';

/** Chainable Mongoose-query stub: supports .select()/.populate() then either
 * .lean() or being awaited directly (thenable). */
function mockQuery(result) {
  const q = {
    select: () => q,
    populate: () => q,
    sort: () => q,
    skip: () => q,
    limit: () => q,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };
  return q;
}

const stubs = {};
function stub(target, key, value) {
  if (!(key in stubs)) stubs[key] = [];
  stubs[key].push([target, key, target[key]]);
  target[key] = value;
}

describe('ClientAccessTokenService', () => {
  afterEach(() => {
    // Restore every stubbed static in reverse order, then clear.
    for (const key of Object.keys(stubs)) {
      for (const [target, k, original] of stubs[key]) {
        target[k] = original;
      }
    }
    for (const key of Object.keys(stubs)) delete stubs[key];
    delete ClientAccessToken.prototype.save;
  });

  // ---------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------
  describe('create', () => {
    it('happy path: persists the token and returns { id, token, url }', async () => {
      stub(User, 'findOne', () => mockQuery({ fileFirma: 'firma.png' }));
      stub(OT, 'find', () =>
        mockQuery([
          { _id: OT_ID_1, ClienteId: CLIENTE_ID },
          { _id: OT_ID_2, ClienteId: CLIENTE_ID },
        ]),
      );
      ClientAccessToken.prototype.save = async function () {
        await this.validate();
        return this;
      };

      const result = await clientAccessTokenService.create(
        { clienteId: CLIENTE_ID, otIds: [OT_ID_1, OT_ID_2] },
        TENANT,
        USER_ID,
      );

      assert.equal(typeof result.id, 'string');
      assert.equal(result.token.length, 32);
      assert.ok(result.url.endsWith(`/portal/${result.token}`));
    });

    it('throws USER_SIGNATURE_MISSING (400) when the user has no fileFirma, without querying OTs', async () => {
      stub(User, 'findOne', () => mockQuery({ fileFirma: '' }));
      let otFindCalled = false;
      stub(OT, 'find', () => {
        otFindCalled = true;
        return mockQuery([]);
      });

      await assert.rejects(
        () => clientAccessTokenService.create({ clienteId: CLIENTE_ID, otIds: [OT_ID_1] }, TENANT, USER_ID),
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'USER_SIGNATURE_MISSING');
          return true;
        },
      );
      assert.equal(otFindCalled, false, 'must fail fast before touching OT.find');
    });

    it('throws USER_SIGNATURE_MISSING (400) when the user does not exist for the tenant', async () => {
      stub(User, 'findOne', () => mockQuery(null));

      await assert.rejects(
        () => clientAccessTokenService.create({ clienteId: CLIENTE_ID, otIds: [OT_ID_1] }, TENANT, USER_ID),
        (err) => {
          assert.equal(err.code, 'USER_SIGNATURE_MISSING');
          return true;
        },
      );
    });

    it('throws OT_NOT_AVAILABLE (400) when an otId is missing/soft-deleted (length mismatch)', async () => {
      stub(User, 'findOne', () => mockQuery({ fileFirma: 'firma.png' }));
      stub(OT, 'find', () => mockQuery([{ _id: OT_ID_1, ClienteId: CLIENTE_ID }])); // only 1 of 2 returned

      await assert.rejects(
        () => clientAccessTokenService.create({ clienteId: CLIENTE_ID, otIds: [OT_ID_1, OT_ID_2] }, TENANT, USER_ID),
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'OT_NOT_AVAILABLE');
          return true;
        },
      );
    });

    it('throws OT_CLIENT_MISMATCH (400) when an OT belongs to a different client', async () => {
      const OTHER_CLIENT = '507f1f77bcf86cd799439099';
      stub(User, 'findOne', () => mockQuery({ fileFirma: 'firma.png' }));
      stub(OT, 'find', () =>
        mockQuery([
          { _id: OT_ID_1, ClienteId: CLIENTE_ID },
          { _id: OT_ID_2, ClienteId: OTHER_CLIENT },
        ]),
      );

      await assert.rejects(
        () => clientAccessTokenService.create({ clienteId: CLIENTE_ID, otIds: [OT_ID_1, OT_ID_2] }, TENANT, USER_ID),
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'OT_CLIENT_MISMATCH');
          return true;
        },
      );
    });

    it('maps a duplicate-key error (nanoid collision) on save to a 500 CREATE_ERROR', async () => {
      stub(User, 'findOne', () => mockQuery({ fileFirma: 'firma.png' }));
      stub(OT, 'find', () => mockQuery([{ _id: OT_ID_1, ClienteId: CLIENTE_ID }]));
      ClientAccessToken.prototype.save = async function () {
        const err = new Error('duplicate key');
        err.code = 11000;
        throw err;
      };

      await assert.rejects(
        () => clientAccessTokenService.create({ clienteId: CLIENTE_ID, otIds: [OT_ID_1] }, TENANT, USER_ID),
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 500);
          assert.equal(err.code, 'CREATE_ERROR');
          return true;
        },
      );
    });
  });

  // ---------------------------------------------------------------------
  // listByTenant()
  // ---------------------------------------------------------------------
  describe('listByTenant', () => {
    it('scopes the query by tenantId + isDeleted:false and forwards clienteId/status filters', async () => {
      let capturedFindQuery = null;
      let capturedCountQuery = null;
      stub(ClientAccessToken, 'find', (q) => {
        capturedFindQuery = q;
        return mockQuery([{ _id: 'tok-1' }]);
      });
      stub(ClientAccessToken, 'countDocuments', (q) => {
        capturedCountQuery = q;
        return Promise.resolve(1);
      });

      const result = await clientAccessTokenService.listByTenant(
        { clienteId: CLIENTE_ID, status: 'active' },
        { page: 1, limit: 20 },
        TENANT,
      );

      assert.deepEqual(capturedFindQuery, { clienteId: CLIENTE_ID, status: 'active', isDeleted: false, tenantId: TENANT });
      assert.deepEqual(capturedCountQuery, capturedFindQuery);
      assert.equal(result.data.length, 1);
      assert.equal(result.pagination.total, 1);
      assert.equal(result.pagination.page, 1);
    });

    it('computes skip/limit and pagination flags from page/limit', async () => {
      let capturedSkip = null;
      let capturedLimit = null;
      stub(ClientAccessToken, 'find', () => {
        const q = mockQuery([]);
        const originalSkip = q.skip;
        const originalLimit = q.limit;
        q.skip = (n) => { capturedSkip = n; return originalSkip(); };
        q.limit = (n) => { capturedLimit = n; return originalLimit(); };
        return q;
      });
      stub(ClientAccessToken, 'countDocuments', () => Promise.resolve(45));

      const result = await clientAccessTokenService.listByTenant({}, { page: 3, limit: 10 }, TENANT);

      assert.equal(capturedSkip, 20); // (page-1) * limit
      assert.equal(capturedLimit, 10);
      assert.equal(result.pagination.pages, 5);
      assert.equal(result.pagination.hasNext, true);
      assert.equal(result.pagination.hasPrev, true);
    });

    it('cross-tenant leakage is impossible: tenantId in the caller filters can never override the argument tenantId', async () => {
      let capturedFindQuery = null;
      stub(ClientAccessToken, 'find', (q) => {
        capturedFindQuery = q;
        return mockQuery([]);
      });
      stub(ClientAccessToken, 'countDocuments', () => Promise.resolve(0));

      // Even if a caller somehow injects a different tenantId into filters,
      // applyTenantFilter appends the real tenantId last and wins.
      await clientAccessTokenService.listByTenant({ tenantId: 'evil-tenant' }, {}, TENANT);

      assert.equal(capturedFindQuery.tenantId, TENANT);
    });
  });

  // ---------------------------------------------------------------------
  // getById()
  // ---------------------------------------------------------------------
  describe('getById', () => {
    it('populates otIds summary + createdBy.fullName and returns the JSON shape', async () => {
      const fakeDoc = {
        toJSON: () => ({ _id: 'tok-1', otIds: [{ Consecutivo: 'OT-1' }], createdBy: { fullName: 'Admin One' } }),
      };
      stub(ClientAccessToken, 'findOne', () => mockQuery(fakeDoc));

      const result = await clientAccessTokenService.getById('507f1f77bcf86cd799439011', TENANT);
      assert.equal(result._id, 'tok-1');
      assert.equal(result.createdBy.fullName, 'Admin One');
    });

    it('throws 404 NOT_FOUND for an invalid ObjectId, without querying the DB', async () => {
      let called = false;
      stub(ClientAccessToken, 'findOne', () => { called = true; return mockQuery(null); });

      await assert.rejects(
        () => clientAccessTokenService.getById('not-an-id', TENANT),
        (err) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        },
      );
      assert.equal(called, false);
    });

    it('throws 404 NOT_FOUND when the token belongs to another tenant (no existence leak)', async () => {
      stub(ClientAccessToken, 'findOne', () => mockQuery(null));

      await assert.rejects(
        () => clientAccessTokenService.getById('507f1f77bcf86cd799439011', TENANT),
        (err) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        },
      );
    });
  });

  // ---------------------------------------------------------------------
  // revoke()
  // ---------------------------------------------------------------------
  describe('revoke', () => {
    it('sets status/revokedAt/revokedBy and returns the JSON shape', async () => {
      const fakeDoc = {
        status: 'active',
        save: async function () { return this; },
        toJSON: function () { return { status: this.status, revokedAt: this.revokedAt, revokedBy: this.revokedBy }; },
      };
      stub(ClientAccessToken, 'findOne', () => mockQuery(fakeDoc));

      const result = await clientAccessTokenService.revoke(TOK_ID, TENANT, USER_ID_2);

      assert.equal(fakeDoc.status, 'revoked');
      assert.ok(fakeDoc.revokedAt instanceof Date);
      assert.equal(fakeDoc.revokedBy, USER_ID_2);
      assert.equal(result.status, 'revoked');
    });

    it('is idempotent: revoking an already-revoked token throws 409 without touching revokedAt', async () => {
      const originalRevokedAt = new Date('2026-01-01T00:00:00.000Z');
      const fakeDoc = {
        status: 'revoked',
        revokedAt: originalRevokedAt,
        save: async function () { throw new Error('save must not be called'); },
      };
      stub(ClientAccessToken, 'findOne', () => mockQuery(fakeDoc));

      await assert.rejects(
        () => clientAccessTokenService.revoke(TOK_ID, TENANT, USER_ID_2),
        (err) => {
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, 'TOKEN_ALREADY_REVOKED');
          return true;
        },
      );
      assert.equal(fakeDoc.revokedAt, originalRevokedAt);
    });

    it('throws 404 NOT_FOUND when the token does not exist for the tenant', async () => {
      stub(ClientAccessToken, 'findOne', () => mockQuery(null));

      await assert.rejects(
        () => clientAccessTokenService.revoke(TOK_ID, TENANT, USER_ID_2),
        (err) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        },
      );
    });
  });

  // ---------------------------------------------------------------------
  // softDelete()
  // ---------------------------------------------------------------------
  describe('softDelete', () => {
    it('sets isDeleted/deletedAt when the token is already revoked', async () => {
      const fakeDoc = { status: 'revoked', isDeleted: false, save: async function () { return this; } };
      stub(ClientAccessToken, 'findOne', () => mockQuery(fakeDoc));

      await clientAccessTokenService.softDelete(TOK_ID, TENANT);

      assert.equal(fakeDoc.isDeleted, true);
      assert.ok(fakeDoc.deletedAt instanceof Date);
    });

    it('rejects with 409 TOKEN_MUST_BE_REVOKED_FIRST when the token is still active', async () => {
      const fakeDoc = {
        status: 'active',
        isDeleted: false,
        save: async function () { throw new Error('save must not be called'); },
      };
      stub(ClientAccessToken, 'findOne', () => mockQuery(fakeDoc));

      await assert.rejects(
        () => clientAccessTokenService.softDelete(TOK_ID, TENANT),
        (err) => {
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, 'TOKEN_MUST_BE_REVOKED_FIRST');
          return true;
        },
      );
      assert.equal(fakeDoc.isDeleted, false);
    });

    it('throws 404 NOT_FOUND when the token does not exist for the tenant', async () => {
      stub(ClientAccessToken, 'findOne', () => mockQuery(null));

      await assert.rejects(
        () => clientAccessTokenService.softDelete(TOK_ID, TENANT),
        (err) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        },
      );
    });
  });
});
