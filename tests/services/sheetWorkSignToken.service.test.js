/**
 * tests/services/sheetWorkSignToken.service.test.js
 *
 * Unit tests for token lifecycle (resolveByToken, renewOnSign,
 * markSuperseded, createForSheet). Mocks the model at the DB boundary.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWorkSignToken } from '../../src/models/sheetWorkSignToken.model.js';
import { sheetWorkSignTokenService } from '../../src/services/sheetWorkSignToken.service.js';
import { SHEET_SIGN_TOKEN_TTL_MS } from '../../src/constants/sheetwork.constants.js';

function chainable(finalValue) {
  const c = {
    setOptions: () => c,
    lean: () => Promise.resolve(finalValue),
    select: () => c,
    then: (resolve) => resolve(finalValue),
  };
  return c;
}

describe('sheetWorkSignTokenService', () => {
  afterEach(() => {
    delete SheetWorkSignToken.findOne;
    delete SheetWorkSignToken.findOneAndUpdate;
    delete SheetWorkSignToken.updateOne;
  });

  describe('resolveByToken', () => {
    it('returns null for unknown tokens', async () => {
      SheetWorkSignToken.findOne = () => chainable(null);
      const result = await sheetWorkSignTokenService.resolveByToken('unknown');
      assert.equal(result, null);
    });

    it('returns null for empty token strings', async () => {
      const result = await sheetWorkSignTokenService.resolveByToken('');
      assert.equal(result, null);
    });

    it('returns { status: revoked } for revoked tokens', async () => {
      SheetWorkSignToken.findOne = () => chainable({
        _id: 'x',
        status: 'revoked',
        expiresAt: new Date(Date.now() + 10_000),
        isDeleted: false,
      });
      const r = await sheetWorkSignTokenService.resolveByToken('r');
      assert.equal(r.status, 'revoked');
    });

    it('returns { status: superseded } for superseded tokens', async () => {
      SheetWorkSignToken.findOne = () => chainable({
        _id: 'x',
        status: 'superseded',
        expiresAt: new Date(Date.now() + 10_000),
        isDeleted: false,
      });
      const r = await sheetWorkSignTokenService.resolveByToken('s');
      assert.equal(r.status, 'superseded');
    });

    it('returns { status: expired } when expiresAt is in the past', async () => {
      const doc = {
        _id: 'x',
        status: 'active',
        expiresAt: new Date(Date.now() - 1_000),
        isDeleted: false,
      };
      SheetWorkSignToken.findOne = () => chainable(doc);
      let updateCall = null;
      SheetWorkSignToken.updateOne = async (filter, update) => { updateCall = { filter, update }; };
      const r = await sheetWorkSignTokenService.resolveByToken('exp');
      assert.equal(r.status, 'expired');
      assert.equal(updateCall.update.$set.status, 'expired');
    });

    it('returns { status: active } for a live token', async () => {
      SheetWorkSignToken.findOne = () => chainable({
        _id: 'x',
        status: 'active',
        expiresAt: new Date(Date.now() + 60_000),
        isDeleted: false,
      });
      const r = await sheetWorkSignTokenService.resolveByToken('ok');
      assert.equal(r.status, 'active');
    });

    it('returns { status: signed } for a signed but still-valid token', async () => {
      SheetWorkSignToken.findOne = () => chainable({
        _id: 'x',
        status: 'signed',
        expiresAt: new Date(Date.now() + 60_000),
        isDeleted: false,
      });
      const r = await sheetWorkSignTokenService.resolveByToken('ok');
      assert.equal(r.status, 'signed');
    });
  });

  describe('renewOnSign', () => {
    it('extends expiresAt by 7 days from signedAt and sets status to signed', async () => {
      let capturedUpdate = null;
      SheetWorkSignToken.updateOne = async (_filter, update) => { capturedUpdate = update; };
      const signedAt = new Date('2026-08-10T10:00:00Z');
      const result = await sheetWorkSignTokenService.renewOnSign('tok', signedAt, {
        ip: '1.2.3.4',
        userAgent: 'ua',
      });
      const expectedExpires = new Date(signedAt.getTime() + SHEET_SIGN_TOKEN_TTL_MS);
      assert.equal(result.expiresAt.getTime(), expectedExpires.getTime());
      assert.equal(capturedUpdate.$set.status, 'signed');
      assert.equal(capturedUpdate.$set.expiresAt.getTime(), expectedExpires.getTime());
      assert.equal(capturedUpdate.$set.signedIp, '1.2.3.4');
      assert.equal(capturedUpdate.$set.signedUserAgent, 'ua');
    });
  });

  describe('markSuperseded', () => {
    it('sets status to superseded and expiresAt to now', async () => {
      let capturedUpdate = null;
      SheetWorkSignToken.updateOne = async (_filter, update) => { capturedUpdate = update; };
      const before = Date.now();
      await sheetWorkSignTokenService.markSuperseded('sheet-1', 'user-a');
      const after = Date.now();
      assert.equal(capturedUpdate.$set.status, 'superseded');
      assert.ok(capturedUpdate.$set.expiresAt.getTime() >= before);
      assert.ok(capturedUpdate.$set.expiresAt.getTime() <= after);
      assert.equal(capturedUpdate.$set.revokedBy, 'user-a');
    });
  });
});
