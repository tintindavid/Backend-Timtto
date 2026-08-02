/**
 * tests/utils/contentHash.test.js
 *
 * Design D7: SHA-256 canonical hash over the signed subset of reports.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { computeSignedContentHash } from '../../src/utils/contentHash.util.js';

describe('computeSignedContentHash', () => {
  it('returns the same hash for the same input', () => {
    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const reports = [
      { _id: id1, updatedAt },
      { _id: id2, updatedAt },
    ];

    assert.equal(computeSignedContentHash(reports), computeSignedContentHash(reports));
  });

  it('reordering reports (same updatedAts) yields the same hash — canonical sort', () => {
    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');

    const hashA = computeSignedContentHash([
      { _id: id1, updatedAt },
      { _id: id2, updatedAt },
    ]);
    const hashB = computeSignedContentHash([
      { _id: id2, updatedAt },
      { _id: id1, updatedAt },
    ]);

    assert.equal(hashA, hashB);
  });

  it('a different updatedAt on one report yields a different hash', () => {
    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAtLater = new Date('2026-01-02T00:00:00.000Z');

    const hashA = computeSignedContentHash([
      { _id: id1, updatedAt },
      { _id: id2, updatedAt },
    ]);
    const hashB = computeSignedContentHash([
      { _id: id1, updatedAt: updatedAtLater },
      { _id: id2, updatedAt },
    ]);

    assert.notEqual(hashA, hashB);
  });

  it('empty input hashes the known deterministic empty-array constant', () => {
    const expected = crypto.createHash('sha256').update('[]').digest('hex');

    assert.equal(computeSignedContentHash([]), expected);
    assert.equal(computeSignedContentHash(undefined), expected);
    assert.equal(computeSignedContentHash(null), expected);
  });
});
