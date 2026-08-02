/**
 * tests/models/clientAccessToken.model.test.js
 *
 * Schema-level invariants for ClientAccessToken. No DB connection required —
 * Mongoose can run `.validate()` on an unsaved document.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';

function validDoc(overrides = {}) {
  return new ClientAccessToken({
    tenantId: 'tenant-1',
    clienteId: new mongoose.Types.ObjectId(),
    otIds: [new mongoose.Types.ObjectId()],
    token: 'a'.repeat(32),
    createdBy: new mongoose.Types.ObjectId(),
    ...overrides,
  });
}

describe('ClientAccessToken model', () => {
  it('passes validation with all required fields present', async () => {
    const doc = validDoc();
    await assert.doesNotReject(() => doc.validate());
  });

  it('rejects when tenantId is missing', async () => {
    const doc = validDoc({ tenantId: undefined });
    await assert.rejects(() => doc.validate());
  });

  it('rejects when otIds is an empty array', async () => {
    const doc = validDoc({ otIds: [] });
    await assert.rejects(() => doc.validate());
  });

  it('rejects when createdBy is missing (fail-fast prerequisite of D6 lives in the service, not here)', async () => {
    const doc = validDoc({ createdBy: undefined });
    await assert.rejects(() => doc.validate());
  });

  it('defaults status to active', () => {
    const doc = validDoc();
    assert.equal(doc.status, 'active');
  });

  it('otClienteIds virtual cross-check rejects a mismatched clienteId', async () => {
    const clienteId = new mongoose.Types.ObjectId();
    const otherClienteId = new mongoose.Types.ObjectId();
    const doc = validDoc({ clienteId });
    doc.otClienteIds = [clienteId, otherClienteId];
    await assert.rejects(() => doc.validate(), /OT_CLIENT_MISMATCH/);
  });

  it('otClienteIds virtual cross-check passes when all match clienteId', async () => {
    const clienteId = new mongoose.Types.ObjectId();
    const doc = validDoc({ clienteId });
    doc.otClienteIds = [clienteId, clienteId];
    await assert.doesNotReject(() => doc.validate());
  });

  it('declares a unique index on token', () => {
    const indexes = ClientAccessToken.schema.indexes();
    const tokenIndex = indexes.find(([fields]) => Object.keys(fields).length === 1 && fields.token === 1);
    assert.ok(tokenIndex, 'expected a { token: 1 } index');
    assert.equal(tokenIndex[1].unique, true);
  });

  it('toJSON hides internal bookkeeping fields', () => {
    const doc = validDoc();
    const json = doc.toJSON();
    assert.equal(json.__v, undefined);
    assert.equal(json.isDeleted, undefined);
    assert.equal(json.deletedAt, undefined);
  });
});
