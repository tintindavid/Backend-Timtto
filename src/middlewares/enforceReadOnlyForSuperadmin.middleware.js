import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * enforceReadOnlyForSuperadmin — global guard that prevents SuperAdmin users
 * from mutating domain data outside of /api/v1/platform/* and /api/v1/auth/*.
 *
 * Design rationale (ADR-013):
 *   A SuperAdmin operates exclusively via /platform/* endpoints (which are
 *   audited). Domain data mutations are the responsibility of tenant admins.
 *   This middleware enforces that constraint globally so it cannot be
 *   accidentally bypassed by adding a new domain router without the guard.
 *
 * Placement in app.js:
 *   Register AFTER platform/auth routes, BEFORE all domain routes.
 *
 * Environment flag:
 *   SUPERADMIN_READONLY=off  → bypasses enforcement (development only).
 *   Default is strict enforcement.
 */
export function enforceReadOnlyForSuperadmin(req, res, next) {
  // Only restrict mutating methods.
  if (!MUTATING_METHODS.has(req.method)) return next();

  // Skip if user is not authenticated (unauthenticated requests are handled
  // by route-level authenticate middleware).
  if (!req.user) return next();

  // Only restricts the superadmin role.
  if (req.user.role !== 'superadmin') return next();

  // Dev escape hatch: SUPERADMIN_READONLY=off bypasses enforcement.
  const flag = process.env.SUPERADMIN_READONLY;
  if (flag === 'off') {
    logger.warn('enforceReadOnlyForSuperadmin: bypassed via SUPERADMIN_READONLY=off', {
      userId: req.user.userId,
      method: req.method,
      path: req.path,
    });
    return next();
  }

  // Platform routes and auth routes are exempt.
  const path = req.path;
  if (path.startsWith('/api/v1/platform/') || path.startsWith('/api/v1/auth/')) {
    return next();
  }

  logger.warn('enforceReadOnlyForSuperadmin: blocked mutation by superadmin on domain route', {
    userId: req.user.userId,
    method: req.method,
    path,
  });

  return next(
    new ApiError(
      403,
      'Los usuarios SuperAdmin no pueden modificar datos de dominio. Use los endpoints /api/v1/platform/* para operaciones de gestión.',
      'SUPERADMIN_READONLY',
    ),
  );
}
