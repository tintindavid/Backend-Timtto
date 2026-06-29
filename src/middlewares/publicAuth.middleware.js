'use strict';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/apiError.util.js';
import { jwtConfig } from '../config/jwt.config.js';
import { ServiceQr } from '../models/serviceQr.model.js';
import { logger } from '../config/logger.config.js';

/**
 * Verifies a public sessionToken (signed with JWT_PUBLIC_SECRET) and attaches
 * the decoded payload to `req.publicSession`. Also enforces:
 *   - QR exists, active, not soft-deleted
 *   - sessionToken.iat >= QR.passwordRotatedAt (D6 — rotation invalidates active sessions)
 *
 * Per requirement spec, panel JWTs signed with JWT_SECRET MUST be rejected here.
 * Different secrets => signature verification fails => 401.
 */
export async function publicAuth(req, res, next) {
  try {
    const header = req.headers.authorization || req.headers.Authorization;
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return next(new ApiError(401, 'Public session token required', 'NO_SESSION_TOKEN'));
    }

    const token = header.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, jwtConfig.publicSession.secret);
    } catch (err) {
      logger.debug && logger.debug('publicAuth: token verification failed', { err: String(err) });
      return next(new ApiError(401, 'Invalid or expired session token', 'INVALID_SESSION_TOKEN'));
    }

    const {
      serviceQrId,
      tenantId,
      ClienteId,
      sedeId,
      servicioId,
      iat,
    } = payload || {};

    if (!serviceQrId || !tenantId || !ClienteId || !sedeId || !servicioId || !iat) {
      return next(new ApiError(401, 'Invalid session token payload', 'INVALID_SESSION_TOKEN'));
    }

    // Resolve QR (include soft-deleted explicitly: still reject below if so).
    const qr = await ServiceQr.findOne({ _id: serviceQrId, tenantId })
      .setOptions({ includeDeleted: true })
      .lean();

    if (!qr || qr.isDeleted || !qr.active) {
      return next(new ApiError(401, 'Session invalidated', 'SESSION_INVALIDATED'));
    }

    // D6: reject sessions issued before the last password rotation.
    // jwt iat is in seconds; passwordRotatedAt is a Date.
    const rotatedAtSec = Math.floor(new Date(qr.passwordRotatedAt || 0).getTime() / 1000);
    if (Number(iat) < rotatedAtSec) {
      return next(new ApiError(401, 'Session invalidated', 'SESSION_INVALIDATED'));
    }

    req.publicSession = {
      serviceQrId: String(serviceQrId),
      tenantId: String(tenantId),
      ClienteId: String(ClienteId),
      sedeId: String(sedeId),
      servicioId: String(servicioId),
      iat: Number(iat),
    };

    // Mirror tenantId into the request so downstream tenant-aware helpers work.
    req.tenantId = String(tenantId);

    return next();
  } catch (err) {
    return next(err);
  }
}
