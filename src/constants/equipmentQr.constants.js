'use strict';

/**
 * EquipmentQr constants — bulk caps, token length, public history limits,
 * and public rate-limit profile.
 *
 * Aligned with design decisions D2 (token length), D8 (history hard-limit),
 * D12 (bulk caps), D15 (public cache) of
 * openspec/changes/equipment-qr-public-history/design.md.
 */

/** nanoid length for qrToken (same as service-qrs, D2). */
export const QR_TOKEN_LENGTH = 21;

/** Hard cap for POST /equipment-qrs/bulk-generate (design D12). */
export const MAX_BULK_SIZE = 500;

/** Hard cap for GET /equipment-qrs/export-pdf bulk (design D12). */
export const MAX_BULK_PDF = 100;

/** Max Report docs returned by the public history endpoint (design D8). */
export const PUBLIC_HISTORY_HARD_LIMIT = 50;

/** Cache-Control max-age (seconds) for the public endpoint (design D15). */
export const PUBLIC_CACHE_SECONDS = 60;

/** Cache-Control stale-while-revalidate (seconds) (design D15). */
export const PUBLIC_SWR_SECONDS = 300;

/** Public endpoint rate limit: requests per IP per rolling minute (design D4). */
export const PUBLIC_RATE_LIMIT_PER_MIN = 60;

/** Window (ms) matching PUBLIC_RATE_LIMIT_PER_MIN. */
export const PUBLIC_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Number of stickers per A4 landscape page in the bulk PDF (2 cols x 5 rows). */
export const BULK_PDF_STICKERS_PER_PAGE = 10;
