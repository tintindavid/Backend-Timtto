/**
 * tests/models/report.clientReview.test.js
 *
 * Schema-level invariants for Report.clientReview (change B, design D1).
 * No DB connection required — Mongoose can run `.validate()` on an unsaved
 * document.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Report } from '../../src/models/report.model.js';

function validDoc(overrides = {}) {
  return new Report({
    tenantId: 'tenant-1',
    ...overrides,
  });
}

describe('Report.clientReview', () => {
  it('does not break a new report when clientReview is not set', async () => {
    const doc = validDoc();
    await assert.doesNotReject(() => doc.validate());

    // Mongoose applies nested-path defaults eagerly for plain object
    // sub-schemas with default values on their children — assert whichever
    // shape it actually produces, both are acceptable "no breakage" outcomes.
    if (doc.clientReview === undefined) {
      assert.equal(doc.clientReview, undefined);
    } else {
      assert.equal(doc.clientReview.reviewedAt, null);
      assert.equal(doc.clientReview.reviewedByTokenId, null);
    }
  });

  it('persists reviewedAt + reviewedByTokenId via .validate() without error', async () => {
    const tokenId = new mongoose.Types.ObjectId();
    const reviewedAt = new Date();
    const doc = validDoc({
      clientReview: {
        reviewedAt,
        reviewedByTokenId: tokenId,
      },
    });

    await assert.doesNotReject(() => doc.validate());
    assert.equal(doc.clientReview.reviewedAt.getTime(), reviewedAt.getTime());
    assert.equal(String(doc.clientReview.reviewedByTokenId), String(tokenId));
  });

  it('setting only reviewedAt leaves reviewedByTokenId at its default (null)', async () => {
    const reviewedAt = new Date();
    const doc = validDoc({ clientReview: { reviewedAt } });

    await assert.doesNotReject(() => doc.validate());
    assert.equal(doc.clientReview.reviewedAt.getTime(), reviewedAt.getTime());
    assert.equal(doc.clientReview.reviewedByTokenId, null);
  });
});
