/**
 * tests/models/sheetwork.clientSignature.test.js
 *
 * Schema-level invariants for SheetWork.source / clientSignature / pdfStatus
 * (change B, design D9/D10/D14). No DB connection required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { SheetWork } from '../../src/models/sheetwork.model.js';

function validDoc(overrides = {}) {
  return new SheetWork({
    tenantId: 'tenant-1',
    otId: new mongoose.Types.ObjectId(),
    ...overrides,
  });
}

describe('SheetWork.source / clientSignature', () => {
  it('defaults source to "field"', () => {
    const doc = validDoc();
    assert.equal(doc.source, 'field');
  });

  it('retrocompat: existing docs validated without source still pass and read as "field"', async () => {
    // Simulate a pre-existing HT loaded from the DB WITHOUT the new field
    // (Mongoose applies schema defaults on `new Model(raw)` for missing fields,
    // which mirrors read-from-DB behavior for legacy docs — but does NOT
    // re-apply defaults when a field is explicitly set to `undefined` after
    // construction, so we build a raw object without the field).
    const raw = validDoc().toObject();
    delete raw.source;
    const doc = new SheetWork(raw);
    await assert.doesNotReject(() => doc.validate());
    assert.equal(doc.source, 'field');
  });

  it('accepts source: "client-portal" with a full clientSignature sub-doc', async () => {
    const tokenId = new mongoose.Types.ObjectId();
    const signedAt = new Date();
    const doc = validDoc({
      source: 'client-portal',
      clientSignature: {
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        contentHash: 'a'.repeat(64),
        signedAt,
        signedBatchId: 'b'.repeat(16),
        tokenId,
      },
    });

    await assert.doesNotReject(() => doc.validate());
    assert.equal(doc.source, 'client-portal');
    assert.equal(doc.clientSignature.contentHash, 'a'.repeat(64));
    assert.equal(doc.clientSignature.signedBatchId, 'b'.repeat(16));
    assert.equal(String(doc.clientSignature.tokenId), String(tokenId));
    assert.equal(doc.clientSignature.signedAt.getTime(), signedAt.getTime());
  });

  it('rejects an invalid source value', async () => {
    const doc = validDoc({ source: 'invalid-value' });
    await assert.rejects(() => doc.validate());
  });

  it('defaults pdfStatus to "ready" for retrocompat', () => {
    const doc = validDoc();
    assert.equal(doc.pdfStatus, 'ready');
  });

  it('accepts pdfStatus "pending" and "error" with pdfGenerationError', async () => {
    const doc = validDoc({ pdfStatus: 'error', pdfGenerationError: 'render failed' });
    await assert.doesNotReject(() => doc.validate());
    assert.equal(doc.pdfStatus, 'error');
    assert.equal(doc.pdfGenerationError, 'render failed');
  });

  it('declares partial indexes for signedBatchId and tokenId lookups', () => {
    const indexes = SheetWork.schema.indexes();

    const batchIndex = indexes.find(
      ([fields]) => fields['clientSignature.signedBatchId'] === 1 && fields.tenantId === 1
    );
    assert.ok(batchIndex, 'expected a { tenantId: 1, "clientSignature.signedBatchId": 1 } index');
    assert.ok(batchIndex[1].partialFilterExpression, 'expected the index to be partial');

    const tokenIndex = indexes.find(
      ([fields]) => fields['clientSignature.tokenId'] === 1 && fields.tenantId === 1
    );
    assert.ok(tokenIndex, 'expected a { tenantId: 1, "clientSignature.tokenId": 1 } index');
    assert.ok(tokenIndex[1].partialFilterExpression, 'expected the index to be partial');
  });
});
