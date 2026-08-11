/**
 * tests/utils/validateSignaturePng.util.test.js
 *
 * Unit tests for the shared blank-PNG detector. Uses real sharp against
 * tiny generated PNGs — no DB, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { validateSignaturePng } from '../../src/utils/validateSignaturePng.util.js';

async function pngBase64(rawBuffer, width, height) {
  const buf = await sharp(rawBuffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return buf.toString('base64');
}

describe('validateSignaturePng', () => {
  it('rejects a fully-white PNG as blank', async () => {
    const w = 20, h = 20;
    const raw = Buffer.alloc(w * h * 4);
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = 255; raw[i + 1] = 255; raw[i + 2] = 255; raw[i + 3] = 255;
    }
    const b64 = await pngBase64(raw, w, h);
    const result = await validateSignaturePng(b64);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_SIGNATURE_IMAGE');
  });

  it('rejects a fully-transparent PNG as blank', async () => {
    const w = 20, h = 20;
    const raw = Buffer.alloc(w * h * 4);
    // alpha 0 across the board — every byte already 0.
    const b64 = await pngBase64(raw, w, h);
    const result = await validateSignaturePng(b64);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_SIGNATURE_IMAGE');
  });

  it('accepts a PNG with drawn dark strokes', async () => {
    const w = 20, h = 20;
    const raw = Buffer.alloc(w * h * 4);
    // Fill white first
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = 255; raw[i + 1] = 255; raw[i + 2] = 255; raw[i + 3] = 255;
    }
    // Paint 10% of pixels black (well over the 0.5% threshold)
    for (let i = 0; i < 40; i += 1) {
      const idx = i * 4;
      raw[idx] = 0; raw[idx + 1] = 0; raw[idx + 2] = 0; raw[idx + 3] = 255;
    }
    const b64 = await pngBase64(raw, w, h);
    const result = await validateSignaturePng(b64);
    assert.equal(result.ok, true);
  });
});
