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

/**
 * Minimum fraction of decoded pixels that must be neither white nor fully
 * transparent for `signature.imagePng` to be accepted (design D4,
 * portal-signature-flow). Below this ratio the PNG is considered blank
 * (empty canvas submission) and rejected with `INVALID_SIGNATURE_IMAGE`.
 */
export const MIN_SIGNATURE_MARKED_RATIO = 0.005;

/**
 * Maximum total pixel count (width × height) accepted by the blank-PNG
 * validator (portal-signature-flow). Guards against decompression bombs:
 * `MAX_SIGNATURE_PNG_BYTES` only bounds the compressed payload, but a highly
 * compressible PNG can decode to ~1 GB of raw RGBA and block the event
 * loop. 2000×2000 = 4M pixels is generous for a signature (the client-side
 * cap is 4000×4000, but any legit signature comfortably fits under this
 * server-side ceiling).
 */
export const MAX_SIGNATURE_TOTAL_PIXELS = 4_000_000;
