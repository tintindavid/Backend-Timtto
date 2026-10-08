'use strict';
import path from 'path';
import fs from 'fs/promises';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { logger } from '../config/logger.config.js';

/**
 * qrImage.util — shared QR PNG generation + persistence helpers.
 *
 * Extracted from `serviceQr.service.js` (design D10,
 * equipment-qr-public-history). `service-qrs` and `equipment-qrs` both
 * delegate here so the PNG format/size/correction-level/storage-path stay
 * identical across both modules.
 *
 * Defaults below (512px, margin 1, correction 'M') are the EXACT values the
 * pre-refactor `serviceQr.service.js._generateQrPng` used via
 * `QRCode.toFile`. Changing them changes scanned output for existing
 * service-qrs stickers — do not change without a design update.
 */
export const QR_PNG_WIDTH = 512;
export const QR_PNG_MARGIN = 1;
export const QR_PNG_ERROR_CORRECTION_LEVEL = 'M';

/** Route prefix per scope — used to build the `qrImageUrl` returned to the admin UI. */
const ROUTE_PREFIX_BY_SCOPE = {
  'service-qrs': (id) => `/api/v1/service-qrs/${id}/qr-image`,
  'equipment-qrs': (id) => `/api/v1/equipment-qrs/${id}/qr-image`,
};

/**
 * Pure PNG buffer generator — no filesystem I/O.
 * @param {string} url - landing URL encoded into the QR.
 * @returns {Promise<Buffer>}
 */
export async function generateQrPng(url, options = {}) {
  const {
    width = QR_PNG_WIDTH,
    margin = QR_PNG_MARGIN,
    errorCorrectionLevel = QR_PNG_ERROR_CORRECTION_LEVEL,
  } = options;
  return QRCode.toBuffer(url, { errorCorrectionLevel, margin, width });
}

/**
 * Resolve the absolute filesystem path for a persisted QR PNG.
 * `scope` namespaces storage between modules: `service-qrs` keeps the
 * legacy flat layout (`QR_IMAGE_STORAGE_PATH/<id>.png`) so existing stickers
 * keep resolving to the same bytes; any other scope gets its own subfolder.
 */
export function getQrPngAbsolutePath(id, scope = 'service-qrs') {
  const baseDir = scope === 'service-qrs'
    ? path.resolve(process.cwd(), env.QR_IMAGE_STORAGE_PATH)
    : path.resolve(process.cwd(), env.QR_IMAGE_STORAGE_PATH, scope);
  return path.join(baseDir, `${id}.png`);
}

/**
 * Persist a PNG buffer to disk and return the API route the frontend uses
 * to fetch it (auth-protected stream, same convention as the pre-existing
 * `GET /api/v1/service-qrs/:id/qr-image`).
 *
 * `tenantId` is accepted (not yet used in the storage path) to keep the
 * signature future-proof for a real multi-tenant storage layout without
 * another breaking refactor — see design D10.
 *
 * @param {Buffer} buffer
 * @param {string} tenantId
 * @param {{ id: string, scope?: string }} opts
 * @returns {Promise<string>} relative API URL
 */
export async function uploadQrPng(buffer, tenantId, { id, scope = 'service-qrs' } = {}) {
  const fullPath = getQrPngAbsolutePath(id, scope);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
  const buildRoute = ROUTE_PREFIX_BY_SCOPE[scope] || ROUTE_PREFIX_BY_SCOPE['service-qrs'];
  return buildRoute(id);
}

/**
 * Read the persisted PNG and return a `data:image/png;base64,...` URI, or
 * null if the file is missing. Used to embed QR images directly into admin
 * list responses / PDFs without an extra authenticated fetch.
 */
export async function readQrPngDataUri(id, scope = 'service-qrs') {
  try {
    const buf = await fs.readFile(getQrPngAbsolutePath(id, scope));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Read the persisted PNG, OR regenerate it on the fly from `landingUrl` if
 * the file is missing (ephemeral filesystem: Railway wipes `uploads/qr` on
 * every redeploy, and horizontal scaling means one instance's write isn't
 * visible to another). The QR is byte-identical for the same `landingUrl`,
 * so regeneration is safe and the caller never has to care whether the
 * sticker was printed before or after the last deploy.
 *
 * A best-effort speculative write back to disk warms the cache for the next
 * read on the same instance; failures (read-only fs, permission) are
 * swallowed and never block the response.
 *
 * @param {string} id - QR record id (filename on disk).
 * @param {string} scope - 'service-qrs' | 'equipment-qrs'.
 * @param {string} landingUrl - URL encoded into the QR (same one used at creation).
 * @returns {Promise<string|null>}
 */
export async function readOrRegenerateQrPngDataUri(id, scope, landingUrl) {
  const existing = await readQrPngDataUri(id, scope);
  if (existing) return existing;
  if (!landingUrl) return null;
  try {
    const buffer = await generateQrPng(landingUrl);
    // Speculative warm-up — the data URI is already assembled below, so a
    // failed write doesn't degrade the current response.
    uploadQrPng(buffer, null, { id, scope }).catch((err) =>
      logger.warn('qrImage.util: speculative PNG write failed', { id, scope, err: String(err) }),
    );
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (err) {
    logger.warn('qrImage.util: on-the-fly regeneration failed', { id, scope, err: String(err) });
    return null;
  }
}

/**
 * Generate the PNG for `url`, persist it, and return the API route.
 * Convenience wrapper around generateQrPng + uploadQrPng for callers that
 * don't need to inspect the intermediate buffer. Errors are logged and
 * swallowed (non-fatal) — mirrors the original `serviceQr` behavior where a
 * failed PNG render never blocks QR record creation.
 */
export async function generateAndUploadQrPng(url, tenantId, { id, scope = 'service-qrs' } = {}) {
  try {
    const buffer = await generateQrPng(url);
    return await uploadQrPng(buffer, tenantId, { id, scope });
  } catch (err) {
    logger.warn('qrImage.util: failed to persist QR PNG', { id, scope, err: String(err) });
    return null;
  }
}
