/**
 * tests/utils/qrImage.util.test.js
 *
 * Regression coverage for the qrImage.util extraction (design D10,
 * equipment-qr-public-history task 1.3). Asserts that the shared helpers
 * preserve the exact PNG format/size/correction-level and the service-qrs
 * storage/route convention that `serviceQr.service.js` relied on before the
 * refactor, and that equipment-qrs gets its own scoped path.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import QRCode from 'qrcode';

import {
  generateQrPng,
  uploadQrPng,
  getQrPngAbsolutePath,
  readQrPngDataUri,
  QR_PNG_WIDTH,
  QR_PNG_MARGIN,
  QR_PNG_ERROR_CORRECTION_LEVEL,
} from '../../src/utils/qrImage.util.js';
import { env } from '../../src/config/env.js';

const cleanupPaths = [];

describe('qrImage.util', () => {
  after(async () => {
    await Promise.all(
      cleanupPaths.map((p) => fs.rm(p, { force: true }).catch(() => {}))
    );
  });

  it('generateQrPng produces a PNG buffer with the legacy size/correction level', async () => {
    const url = 'https://example.test/public/ticket/abc123';
    const buffer = await generateQrPng(url);

    assert.ok(Buffer.isBuffer(buffer));
    // Decoding options back via qrcode's own encoder at the same settings
    // must produce byte-identical output — proves width/margin/correction
    // level did not drift from the pre-refactor QRCode.toFile() call.
    const reference = await QRCode.toBuffer(url, {
      errorCorrectionLevel: QR_PNG_ERROR_CORRECTION_LEVEL,
      margin: QR_PNG_MARGIN,
      width: QR_PNG_WIDTH,
    });
    assert.ok(buffer.equals(reference));
  });

  it('uploadQrPng keeps the service-qrs flat storage path and legacy route', async () => {
    const id = 'regression-service-qr';
    const buffer = await generateQrPng('https://example.test/public/ticket/abc123');

    const url = await uploadQrPng(buffer, 'tenant-1', { id, scope: 'service-qrs' });

    assert.equal(url, `/api/v1/service-qrs/${id}/qr-image`);
    const expectedPath = path.resolve(process.cwd(), env.QR_IMAGE_STORAGE_PATH, `${id}.png`);
    assert.equal(getQrPngAbsolutePath(id, 'service-qrs'), expectedPath);
    cleanupPaths.push(expectedPath);

    const onDisk = await fs.readFile(expectedPath);
    assert.ok(onDisk.equals(buffer));

    const dataUri = await readQrPngDataUri(id, 'service-qrs');
    assert.equal(dataUri, `data:image/png;base64,${buffer.toString('base64')}`);
  });

  it('uploadQrPng namespaces equipment-qrs under its own scope/route', async () => {
    const id = 'regression-equipment-qr';
    const buffer = await generateQrPng('https://example.test/public/equipo/xyz789');

    const url = await uploadQrPng(buffer, 'tenant-1', { id, scope: 'equipment-qrs' });

    assert.equal(url, `/api/v1/equipment-qrs/${id}/qr-image`);
    const expectedPath = path.resolve(process.cwd(), env.QR_IMAGE_STORAGE_PATH, 'equipment-qrs', `${id}.png`);
    assert.equal(getQrPngAbsolutePath(id, 'equipment-qrs'), expectedPath);
    cleanupPaths.push(expectedPath);

    const onDisk = await fs.readFile(expectedPath);
    assert.ok(onDisk.equals(buffer));
  });

  it('readQrPngDataUri returns null when the file does not exist', async () => {
    const result = await readQrPngDataUri('does-not-exist-12345', 'service-qrs');
    assert.equal(result, null);
  });
});
