'use strict';

/**
 * ServiceQr constants — QR generation, password policy, and rate-limit
 * profiles referenced by middlewares, DTOs and services.
 *
 * Aligned with design decisions D5 (uniqueness), D6 (manual rotation),
 * D7 (separate public secret), D8 (sessionToken TTL), D9 (rate limits).
 */

/** nanoid length for qrToken */
export const QR_TOKEN_LENGTH = 21;

/** bcrypt cost factor for hashed QR password */
export const QR_PASSWORD_BCRYPT_ROUNDS = 10;

/** Password policy: 8..32 chars, at least one upper, one lower, one digit */
export const QR_PASSWORD_MIN = 8;
export const QR_PASSWORD_MAX = 32;
export const QR_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%^&*()_\-+=.,;:?]{8,32}$/;

/**
 * Rate limit: validate-access bucket per (IP + qrToken).
 * 5 attempts per 15 minutes (design D9).
 */
export const VALIDATE_ACCESS_WINDOW_MS = 15 * 60 * 1000;
export const VALIDATE_ACCESS_MAX = 5;

/**
 * Rate limit: validate-access broader cap per IP.
 * 20 attempts per hour (design D9).
 */
export const VALIDATE_ACCESS_IP_WINDOW_MS = 60 * 60 * 1000;
export const VALIDATE_ACCESS_IP_MAX = 20;

/**
 * Rate limit: public ticket creation per sessionToken.
 * 10 creations per minute (Open Question Q7, conservative default).
 */
export const PUBLIC_TICKET_CREATE_WINDOW_MS = 60 * 1000;
export const PUBLIC_TICKET_CREATE_MAX = 10;
