import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { PROVEEDOR_TOKEN_BYTES, PROVEEDOR_TOKEN_HINT_LENGTH } from '../constants/requisicion.constants.js';

/**
 * Supplier portal tokens (E3). 32 random bytes in base64url. Only the SHA-256 hash and the last characters (hint) are
 * stored; the clear token exists in memory just long enough to build the e-mailed link. NEVER log a token or a link.
 */

/** base64url of 32 bytes is exactly 43 characters. */
export const PROVEEDOR_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** @returns {{ token: string, tokenHash: string, tokenHint: string }} */
export function generateProveedorToken() {
  const token = crypto.randomBytes(PROVEEDOR_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashToken(token), tokenHint: token.slice(-PROVEEDOR_TOKEN_HINT_LENGTH) };
}

/** Cheap shape check done before touching the database (a malformed token can never match). */
export function isPlausibleToken(token) {
  return typeof token === 'string' && PROVEEDOR_TOKEN_REGEX.test(token);
}

/** `${PUBLIC_APP_URL}/public/requisicion/${token}` (no trailing slash duplication). */
export function buildPortalLink(token, baseUrl = env.PUBLIC_APP_URL) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/public/requisicion/${token}`;
}
