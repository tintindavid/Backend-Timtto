/**
 * tests/dtos/clientPortalSign.dto.test.js
 *
 * Design D10: signature image (PNG magic-bytes + size) and signer field
 * bounds for POST /public/client-view/:token/sign.
 * Design D4 (portal-signature-flow): blank/transparent PNG rejection via
 * an async `sharp`-based pixel check — the schema now carries an
 * `.external()` rule, so every assertion here uses `validateAsync()`
 * (Joi throws synchronously if `.validate()` is called on a schema with
 * external rules).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import sharp from 'sharp';
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

/** Real, decodable PNG (via sharp) so it survives the base64/size/magic-bytes
 * gate and reaches the blank-pixel check. */
async function realPngBase64(background) {
  const buf = await sharp({
    create: { width: 40, height: 20, channels: 4, background },
  })
    .png()
    .toBuffer();
  return buf.toString('base64');
}

/** A PNG with a visible dark diagonal stroke over a white background. */
async function pngWithStrokeBase64() {
  const width = 40;
  const height = 20;
  const raw = Buffer.alloc(width * height * 4, 255); // opaque white
  for (let i = 0; i < Math.min(width, height); i += 1) {
    const idx = (i * width + i) * 4;
    raw[idx] = 0;
    raw[idx + 1] = 0;
    raw[idx + 2] = 0;
    raw[idx + 3] = 255;
  }
  const buf = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return buf.toString('base64');
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
  it('rejects an empty reportIds array', async () => {
    await assert.rejects(() =>
      clientPortalSignDto.validateAsync({
        reportIds: [],
        signature: baseBody().signature,
      })
    );
  });

  it('rejects imagePng larger than MAX_SIGNATURE_PNG_BYTES decoded', async () => {
    const oversized = pngBase64(MAX_SIGNATURE_PNG_BYTES + 1);
    await assert.rejects(() => clientPortalSignDto.validateAsync(baseBody({ imagePng: oversized })));
  });

  it('rejects imagePng whose magic bytes are not PNG (JPEG payload)', async () => {
    await assert.rejects(() => clientPortalSignDto.validateAsync(baseBody({ imagePng: jpegBase64() })));
  });

  it('rejects imagePng that is not valid base64', async () => {
    await assert.rejects(() => clientPortalSignDto.validateAsync(baseBody({ imagePng: 'not-valid-base64!!!' })));
  });

  it('rejects signerName shorter than the minimum length', async () => {
    await assert.rejects(() => clientPortalSignDto.validateAsync(baseBody({ signerName: 'Jo' })));
  });

  it('rejects signerName longer than the maximum length', async () => {
    await assert.rejects(() => clientPortalSignDto.validateAsync(baseBody({ signerName: 'a'.repeat(101) })));
  });

  it('rejects signerId shorter than the minimum length', async () => {
    await assert.rejects(() => clientPortalSignDto.validateAsync(baseBody({ signerId: '123' })));
  });

  it('rejects signerId longer than the maximum length', async () => {
    await assert.rejects(() => clientPortalSignDto.validateAsync(baseBody({ signerId: '1'.repeat(31) })));
  });

  it('accepts an optional cargo field within bounds', async () => {
    const strokePng = await pngWithStrokeBase64();
    const value = await clientPortalSignDto.validateAsync(baseBody({ imagePng: strokePng, cargo: 'Jefe de mantenimiento' }));
    assert.equal(value.signature.cargo, 'Jefe de mantenimiento');
  });

  it('rejects unknown top-level fields', async () => {
    await assert.rejects(() => clientPortalSignDto.validateAsync({ ...baseBody(), extra: 'nope' }));
  });

  describe('blank-PNG rejection (design D4)', () => {
    it('rejects a fully white PNG', async () => {
      const white = await realPngBase64({ r: 255, g: 255, b: 255, alpha: 1 });
      try {
        await clientPortalSignDto.validateAsync(baseBody({ imagePng: white }));
        assert.fail('expected validation to reject a blank white PNG');
      } catch (err) {
        assert.ok(err.details.some((d) => d.type === 'imagePng.blank'));
      }
    });

    it('rejects a fully transparent PNG', async () => {
      const transparent = await realPngBase64({ r: 0, g: 0, b: 0, alpha: 0 });
      try {
        await clientPortalSignDto.validateAsync(baseBody({ imagePng: transparent }));
        assert.fail('expected validation to reject a blank transparent PNG');
      } catch (err) {
        assert.ok(err.details.some((d) => d.type === 'imagePng.blank'));
      }
    });

    it('accepts a PNG with visible dark strokes', async () => {
      const strokePng = await pngWithStrokeBase64();
      const value = await clientPortalSignDto.validateAsync(baseBody({ imagePng: strokePng }));
      assert.equal(value.signature.imagePng, strokePng);
    });

    it('still rejects an oversized PNG even though it has visible strokes (existing size rule)', async () => {
      const oversized = pngBase64(MAX_SIGNATURE_PNG_BYTES + 1);
      await assert.rejects(() => clientPortalSignDto.validateAsync(baseBody({ imagePng: oversized })));
    });

    it('rejects a decompression-bomb PNG (tiny file, huge dimensions) with tooLarge', async () => {
      // A 3000x3000 solid-color PNG compresses to < 500 KB (well under
      // MAX_SIGNATURE_PNG_BYTES) but decodes to ~36 MB of raw RGBA — enough
      // to block the event loop for seconds during the per-pixel walk if
      // the dimension cap is missing. The DTO must reject via metadata
      // BEFORE the raw decode + pixel loop even runs. 3000*3000 = 9M > 4M
      // cap.
      const bomb = await sharp({
        create: { width: 3000, height: 3000, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      // Sanity-check the compressed size is under the byte cap so we're
      // actually exercising the dimension gate, not the size gate.
      assert.ok(bomb.length <= MAX_SIGNATURE_PNG_BYTES, `bomb PNG is ${bomb.length} bytes, must be <= ${MAX_SIGNATURE_PNG_BYTES}`);
      const base64 = bomb.toString('base64');
      try {
        await clientPortalSignDto.validateAsync(baseBody({ imagePng: base64 }));
        assert.fail('expected validation to reject the oversized-dimension PNG');
      } catch (err) {
        assert.ok(err.details.some((d) => d.type === 'imagePng.tooLarge'));
      }
    });
  });
});
