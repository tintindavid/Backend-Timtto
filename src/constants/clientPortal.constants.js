'use strict';

/**
 * Client Portal constants — opaque token length and public-read rate limits.
 *
 * Aligned with design decisions D1 (nanoid(32), no hashing) and D7 (extend
 * the existing rateLimiter.middleware.js instead of a new file).
 */

/** nanoid length for ClientAccessToken.token — 32 chars (~192 bits entropy). */
export const CLIENT_TOKEN_LENGTH = 32;

/**
 * Rate limit: public portal reads, per token. 60 requests/minute (design D7).
 */
export const CLIENT_PORTAL_READ_WINDOW_MS = 60 * 1000;
export const CLIENT_PORTAL_READ_MAX = 60;

/**
 * Rate limit: public portal reads, per IP (fallback/backstop). 60 requests/minute.
 */
export const CLIENT_PORTAL_READ_IP_WINDOW_MS = 60 * 1000;
export const CLIENT_PORTAL_READ_IP_MAX = 60;

/**
 * Client-portal signature (change B, design D10). Max decoded size of the
 * base64 signature PNG payload accepted by `POST /:token/sign`.
 */
export const MAX_SIGNATURE_PNG_BYTES = 500_000;

/** nanoid length for `SheetWork.clientSignature.signedBatchId` (design D6). */
export const SIGN_BATCH_ID_LENGTH = 16;

/** Bounds for `signature.signerName` (design D10). */
export const SIGNER_NAME_MIN_LENGTH = 3;
export const SIGNER_NAME_MAX_LENGTH = 100;

/** Bounds for `signature.signerId` (design D10). */
export const SIGNER_ID_MIN_LENGTH = 5;
export const SIGNER_ID_MAX_LENGTH = 30;

/** Bounds for the optional `signature.cargo` (design D10). */
export const SIGNER_CARGO_MAX_LENGTH = 100;

/** Max text length for `Report.clientNote.text` set from the portal (2026-08-02). */
export const CLIENT_NOTE_MAX_LENGTH = 1000;

/** PNG magic bytes (first 8 bytes of any valid PNG file). */
export const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
