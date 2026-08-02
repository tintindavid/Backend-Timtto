'use strict';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import {
  VALIDATE_ACCESS_WINDOW_MS,
  VALIDATE_ACCESS_MAX,
  VALIDATE_ACCESS_IP_WINDOW_MS,
  VALIDATE_ACCESS_IP_MAX,
  PUBLIC_TICKET_CREATE_WINDOW_MS,
  PUBLIC_TICKET_CREATE_MAX,
} from '../constants/serviceQr.constants.js';
import {
  CLIENT_PORTAL_READ_WINDOW_MS,
  CLIENT_PORTAL_READ_MAX,
  CLIENT_PORTAL_READ_IP_WINDOW_MS,
  CLIENT_PORTAL_READ_IP_MAX,
} from '../constants/clientPortal.constants.js';

export const rateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      message: 'Demasiadas solicitudes. Por favor intenta nuevamente en 15 minutos',
      error: { code: 'RATE_LIMIT_EXCEEDED', details: { retryAfter: Math.floor(env.RATE_LIMIT_WINDOW_MS / 1000) } },
    }),
});

/**
 * Build a 429 JSON response with a Retry-After header in seconds.
 * Used by the public limiters below.
 */
function buildLimitHandler(windowMs, code, message) {
  return (req, res /* , next, options */) => {
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.set('Retry-After', String(retryAfterSec));
    res.status(429).json({
      success: false,
      message,
      error: { code, details: { retryAfter: retryAfterSec } },
    });
  };
}

/**
 * Per (IP + qrToken) limiter for POST /public/tickets/validate-access.
 * 5 attempts per 15 minutes (design D9).
 */
export const validateAccessLimiter = rateLimit({
  windowMs: VALIDATE_ACCESS_WINDOW_MS,
  max: VALIDATE_ACCESS_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const qrToken =
      (req.body && typeof req.body.qrToken === 'string' && req.body.qrToken.trim()) || 'no-token';
    return `va:${ip}:${qrToken}`;
  },
  handler: buildLimitHandler(
    VALIDATE_ACCESS_WINDOW_MS,
    'RATE_LIMIT_VALIDATE_ACCESS',
    'Demasiados intentos. Por favor intenta nuevamente más tarde.'
  ),
});

/**
 * Broader per-IP limiter for /validate-access — 20 attempts/hour.
 * Mount BEFORE validateAccessLimiter on the route so both apply.
 */
export const validateAccessIpLimiter = rateLimit({
  windowMs: VALIDATE_ACCESS_IP_WINDOW_MS,
  max: VALIDATE_ACCESS_IP_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `va-ip:${req.ip || req.connection?.remoteAddress || 'unknown'}`,
  handler: buildLimitHandler(
    VALIDATE_ACCESS_IP_WINDOW_MS,
    'RATE_LIMIT_VALIDATE_ACCESS_IP',
    'Demasiados intentos desde tu IP. Por favor intenta nuevamente en una hora.'
  ),
});

/**
 * Per-sessionToken limiter for POST /public/tickets (creation).
 * 10 creations per minute (Q7 default). Falls back to IP if the session
 * is not yet attached.
 */
export const publicTicketCreateLimiter = rateLimit({
  windowMs: PUBLIC_TICKET_CREATE_WINDOW_MS,
  max: PUBLIC_TICKET_CREATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const sid = req.publicSession && req.publicSession.serviceQrId;
    if (sid) return `ptc:qr:${sid}`;
    return `ptc:ip:${req.ip || 'unknown'}`;
  },
  handler: buildLimitHandler(
    PUBLIC_TICKET_CREATE_WINDOW_MS,
    'RATE_LIMIT_PUBLIC_TICKET_CREATE',
    'Demasiadas solicitudes. Espera un momento antes de crear más tickets.'
  ),
});

/**
 * Client portal (public read) — per-token limiter. 60 req/min (design D7).
 * Mounted on every /api/public/client-view/* route, keyed by req.params.token.
 */
export const clientPortalReadLimiter = rateLimit({
  windowMs: CLIENT_PORTAL_READ_WINDOW_MS,
  max: CLIENT_PORTAL_READ_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `cpr:tok:${req.params.token || 'no-token'}`,
  handler: buildLimitHandler(
    CLIENT_PORTAL_READ_WINDOW_MS,
    'RATE_LIMIT_CLIENT_PORTAL_READ',
    'Demasiadas solicitudes al portal cliente. Intenta en un momento.'
  ),
});

/**
 * Client portal (public read) — per-IP backstop limiter. 60 req/min.
 * Catches token-enumeration attempts that rotate the token param per request.
 */
export const clientPortalReadIpLimiter = rateLimit({
  windowMs: CLIENT_PORTAL_READ_IP_WINDOW_MS,
  max: CLIENT_PORTAL_READ_IP_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `cpr:ip:${req.ip || req.connection?.remoteAddress || 'unknown'}`,
  handler: buildLimitHandler(
    CLIENT_PORTAL_READ_IP_WINDOW_MS,
    'RATE_LIMIT_CLIENT_PORTAL_READ_IP',
    'Demasiadas solicitudes desde tu IP. Intenta en un momento.'
  ),
});
