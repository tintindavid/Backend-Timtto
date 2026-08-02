/**
 * tests/dtos/clientPortalSign.dto.test.js
 *
 * Design D10: signature image (PNG magic-bytes + size) and signer field
 * bounds for POST /public/client-view/:token/sign.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { clientPortalSignDto } from '../../src/dtos/clientPortalSign.dto.js';
import { MAX_SIGNATURE_PNG_BYTES } from '../../src/constants/clientPortal.constants.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function pngBase64(bodySize = 32) {
  return Buffer.concat([PNG_MAGIC, Buffer.alloc(bodySize, 0x01)]).toString('base64');
}

function jpegBase64(bodySize = 32) {
  return Buffer.concat([JPEG_MAGIC, Buffer.alloc(bodySize, 0x01)]).toString('base64');
}

function baseBody(overrides = {}) {
  return {
    reportIds: [new mongoose.Types.ObjectId().toString()],
    signature: {
      imagePng: pngBase64(),
      signerName: 'Juan Perez',
      signerId: '1234567',
      ...overrides,
    },
  };
}

describe('clientPortalSignDto', () => {
  it('rejects an empty reportIds array', () => {
    const { error } = clientPortalSignDto.validate({
      reportIds: [],
      signature: baseBody().signature,
    });
    assert.ok(error);
  });

  it('rejects imagePng larger than MAX_SIGNATURE_PNG_BYTES decoded', () => {
    const oversized = pngBase64(MAX_SIGNATURE_PNG_BYTES + 1);
    const { error } = clientPortalSignDto.validate(baseBody({ imagePng: oversized }));
    assert.ok(error);
  });

  it('rejects imagePng whose magic bytes are not PNG (JPEG payload)', () => {
    const { error } = clientPortalSignDto.validate(baseBody({ imagePng: jpegBase64() }));
    assert.ok(error);
  });

  it('rejects imagePng that is not valid base64', () => {
    const { error } = clientPortalSignDto.validate(baseBody({ imagePng: 'not-valid-base64!!!' }));
    assert.ok(error);
  });

  it('rejects signerName shorter than the minimum length', () => {
    const { error } = clientPortalSignDto.validate(baseBody({ signerName: 'Jo' }));
    assert.ok(error);
  });

  it('rejects signerName longer than the maximum length', () => {
    const { error } = clientPortalSignDto.validate(baseBody({ signerName: 'a'.repeat(101) }));
    assert.ok(error);
  });

  it('rejects signerId shorter than the minimum length', () => {
    const { error } = clientPortalSignDto.validate(baseBody({ signerId: '123' }));
    assert.ok(error);
  });

  it('rejects signerId longer than the maximum length', () => {
    const { error } = clientPortalSignDto.validate(baseBody({ signerId: '1'.repeat(31) }));
    assert.ok(error);
  });

  it('accepts a happy-path payload with a minimal PNG stub', () => {
    const { error, value } = clientPortalSignDto.validate(baseBody());
    assert.equal(error, undefined);
    assert.ok(Array.isArray(value.reportIds));
    assert.equal(value.signature.signerName, 'Juan Perez');
  });

  it('accepts an optional cargo field within bounds', () => {
    const { error } = clientPortalSignDto.validate(baseBody({ cargo: 'Jefe de mantenimiento' }));
    assert.equal(error, undefined);
  });

  it('rejects unknown top-level fields', () => {
    const { error } = clientPortalSignDto.validate({ ...baseBody(), extra: 'nope' });
    assert.ok(error);
  });
});
