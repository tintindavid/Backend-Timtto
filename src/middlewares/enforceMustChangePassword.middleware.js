import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

/**
 * Paths that are explicitly exempt from the mustChangePassword check.
 * A user with mustChangePassword=true MUST be able to reach:
 *   - POST /api/v1/auth/change-password  (to fix the flag)
 *   - POST /api/v1/auth/logout           (to invalidate the session)
 *   - POST /api/v1/auth/refresh-token    (so the session stays alive)
 */
const EXEMPT_PATHS = new Set([
  '/api/v1/auth/change-password',
  '/api/v1/auth/logout',
  '/api/v1/auth/refresh-token',
]);

/**
 * enforceMustChangePassword — global guard that blocks all routes for users
 * who have mustChangePassword=true, except the paths above.
 *
 * Design decision (D5):
 *   The JWT payload does NOT include mustChangePassword to avoid stale state.
 *   This middleware performs one DB projection per authenticated request
 *   (User.findById.select('mustChangePassword')) — acceptable given the
 *   expected call frequency. Redis caching is a planned follow-up.
 *
 * Placement in app.js:
 *   Register AFTER platform/auth routes, BEFORE all domain routes.
 *   Depends on a prior "soft authenticate" pass that sets req.user from the JWT.
 */
export async function enforceMustChangePassword(req, res, next) {
  // Skip if no authenticated user (unauthenticated requests handled by route-level auth).
  if (!req.user) return next();

  // Skip exempt paths (change-password, logout, refresh).
  const path = req.path;
  if (EXEMPT_PATHS.has(path)) return next();

  const userId = req.user.userId || req.user.id;
  if (!userId) return next();

  try {
    const user = await User.findById(userId).select('mustChangePassword').lean();

    if (!user) return next(); // User not found — let route-level auth handle it.

    if (user.mustChangePassword === true) {
      logger.info('enforceMustChangePassword: blocking request — password change required', {
        userId,
        path,
      });
      return next(
        new ApiError(
          428,
          'Debe cambiar su contraseña antes de continuar. Use POST /api/v1/auth/change-password.',
          'MUST_CHANGE_PASSWORD',
        ),
      );
    }
  } catch (err) {
    // On DB failure, log and allow the request to proceed.
    // The route-level guard remains the last line of defence.
    logger.error('enforceMustChangePassword: DB query failed, allowing request through', {
      userId,
      error: err.message,
    });
  }

  return next();
}
