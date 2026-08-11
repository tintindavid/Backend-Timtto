'use strict';
import sharp from 'sharp';
import {
  MIN_SIGNATURE_MARKED_RATIO,
  MAX_SIGNATURE_TOTAL_PIXELS,
} from '../constants/clientPortal.constants.js';

/**
 * Shared blank-PNG detector used by every DTO that accepts a signature.
 * Called AFTER a base64 + PNG magic-bytes check has already run, so `value`
 * is guaranteed to be a well-formed PNG payload.
 *
 * Decodes with sharp, walks every RGBA pixel, rejects when fewer than
 * MIN_SIGNATURE_MARKED_RATIO of pixels are neither white nor transparent.
 * Also caps total pixel count to guard against decompression bombs.
 */
export async function validateSignaturePng(base64Value) {
  const decoded = Buffer.from(base64Value, 'base64');

  let meta;
  try {
    meta = await sharp(decoded).metadata();
  } catch {
    return { ok: false, code: 'NOT_PNG', errorType: 'imagePng.notPng' };
  }
  if (!meta.width || !meta.height) {
    return { ok: false, code: 'NOT_PNG', errorType: 'imagePng.notPng' };
  }
  if (meta.width * meta.height > MAX_SIGNATURE_TOTAL_PIXELS) {
    return { ok: false, code: 'TOO_LARGE', errorType: 'imagePng.tooLarge' };
  }

  let data;
  let info;
  try {
    ({ data, info } = await sharp(decoded, { limitInputPixels: MAX_SIGNATURE_TOTAL_PIXELS })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    return { ok: false, code: 'NOT_PNG', errorType: 'imagePng.notPng' };
  }

  const totalPx = info.width * info.height;
  if (totalPx === 0) {
    return { ok: false, code: 'INVALID_SIGNATURE_IMAGE', errorType: 'imagePng.blank' };
  }

  let markedPx = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const isTransparent = a === 0;
    const isWhite = r >= 245 && g >= 245 && b >= 245;
    if (!isTransparent && !isWhite) markedPx += 1;
  }

  if (markedPx / totalPx < MIN_SIGNATURE_MARKED_RATIO) {
    return { ok: false, code: 'INVALID_SIGNATURE_IMAGE', errorType: 'imagePng.blank' };
  }

  return { ok: true };
}
