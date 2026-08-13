/**
 * tests/services/sheetWorkDownloadToken.service.test.js
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWorkDownloadToken } from '../../src/models/sheetWorkDownloadToken.model.js';
import { sheetWorkDownloadTokenService } from '../../src/services/sheetWorkDownloadToken.service.js';
import {
  SHEET_SHARE_DOWNLOAD_TTL_MS,
  SHEET_SHARE_HT_DOWNLOADS_ALLOWED,
  SHEET_SHARE_REPORTS_DOWNLOADS_ALLOWED,
} from '../../src/constants/sheetwork.constants.js';

function chainable(finalValue) {
  const c = {
    setOptions: () => c,
    lean: () => Promise.resolve(finalValue),
    select: () => c,
    then: (resolve) => resolve(finalValue),
  };
  return c;
}

describe('sheetWorkDownloadTokenService', () => {
  afterEach(() => {
    delete SheetWorkDownloadToken.findOne;
    delete SheetWorkDownloadToken.findOneAndUpdate;
    delete SheetWorkDownloadToken.updateOne;
  });

  describe('resolveByToken', () => {
    it('returns null for unknown tokens', async () => {
      SheetWorkDownloadToken.findOne = () => chainable(null);
      const r = await sheetWorkDownloadTokenService.resolveByToken('unknown');
      assert.equal(r, null);
    });

    it('returns active for a live token with quota', async () => {
      SheetWorkDownloadToken.findOne = () => chainable({
        _id: 't1',
        status: 'active',
        expiresAt: new Date(Date.now() + 60_000),
        downloadsUsed: 0,
        downloadsAllowed: 3,
        isDeleted: false,
      });
      const r = await sheetWorkDownloadTokenService.resolveByToken('x');
      assert.equal(r.status, 'active');
    });

    it('returns expired when expiresAt is in the past and flips status', async () => {
      const doc = {
        _id: 't1',
        status: 'active',
        expiresAt: new Date(Date.now() - 1000),
        isDeleted: false,
      };
      SheetWorkDownloadToken.findOne = () => chainable(doc);
      let updateCall = null;
      SheetWorkDownloadToken.updateOne = async (f, u) => { updateCall = { f, u }; };
      const r = await sheetWorkDownloadTokenService.resolveByToken('x');
      assert.equal(r.status, 'expired');
      assert.equal(updateCall.u.$set.status, 'expired');
    });

    it('returns exhausted for a token whose status is already exhausted', async () => {
      SheetWorkDownloadToken.findOne = () => chainable({
        _id: 't1',
        status: 'exhausted',
        expiresAt: new Date(Date.now() + 60_000),
        isDeleted: false,
      });
      const r = await sheetWorkDownloadTokenService.resolveByToken('x');
      assert.equal(r.status, 'exhausted');
    });

    it('returns revoked for a revoked token', async () => {
      SheetWorkDownloadToken.findOne = () => chainable({
        _id: 't1',
        status: 'revoked',
        expiresAt: new Date(Date.now() + 60_000),
        isDeleted: false,
      });
      const r = await sheetWorkDownloadTokenService.resolveByToken('x');
      assert.equal(r.status, 'revoked');
    });
  });

  describe('incrementHtDownload', () => {
    it('returns ok:false when no doc matches the atomic quota filter', async () => {
      SheetWorkDownloadToken.findOneAndUpdate = async () => null;
      const r = await sheetWorkDownloadTokenService.incrementHtDownload('t1');
      assert.equal(r.ok, false);
    });

    it('returns ok:true and flips to exhausted when the increment fills the quota', async () => {
      SheetWorkDownloadToken.findOneAndUpdate = async () => ({
        _id: 't1',
        downloadsUsed: 3,
        downloadsAllowed: 3,
      });
      let flipCall = null;
      SheetWorkDownloadToken.updateOne = async (f, u) => { flipCall = u; };
      const r = await sheetWorkDownloadTokenService.incrementHtDownload('t1');
      assert.equal(r.ok, true);
      assert.equal(r.doc.status, 'exhausted');
      assert.equal(flipCall.$set.status, 'exhausted');
    });

    it('stays active while there are downloads remaining', async () => {
      SheetWorkDownloadToken.findOneAndUpdate = async () => ({
        _id: 't1',
        downloadsUsed: 2,
        downloadsAllowed: 3,
      });
      const r = await sheetWorkDownloadTokenService.incrementHtDownload('t1');
      assert.equal(r.ok, true);
      assert.notEqual(r.doc.status, 'exhausted');
    });
  });

  describe('incrementReportDownload', () => {
    it('returns ok:false when the token disallows reports', async () => {
      SheetWorkDownloadToken.findOneAndUpdate = async () => null;
      const r = await sheetWorkDownloadTokenService.incrementReportDownload('t1');
      assert.equal(r.ok, false);
    });

    it('returns ok:true when the increment succeeds', async () => {
      SheetWorkDownloadToken.findOneAndUpdate = async () => ({
        _id: 't1',
        reportDownloadsUsed: 1,
        reportDownloadsAllowed: 2,
      });
      const r = await sheetWorkDownloadTokenService.incrementReportDownload('t1');
      assert.equal(r.ok, true);
    });
  });
});
