import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import {
  MUTATING_METHODS,
  findRequiredCapability,
  getEnforcementMode,
  normalizeCapabilities,
} from '../config/tenantCapabilities.config.js';

/**
 * enforceTenantCapabilities — global guard that applies the tenant capability ceiling
 * (spec: tenant-capabilities). Mutating requests (POST/PUT/PATCH/DELETE) of the execution flow
 * (the declarative map in config/tenantCapabilities.config.js) are rejected with
 * 403 CAPABILITY_DISABLED when the tenant does not have the capability. Reads stay available so
 * history remains readable.
 *
 * Scope:
 *   - only authenticated, non-superadmin requests (superadmin is already read-only on domain routes
 *     and unauthenticated token flows have no tenant context; route-level authenticate decides);
 *   - req.tenant.capabilities is set by tenantResolver from its single tenant query, and for an
 *     authenticated non-superadmin user req.tenantId is the token's tenant (enforceTenantTokenMatch),
 *     so the value cannot be switched with a header.
 *
 * Placement in app.js: right after enforceReadOnlyForSuperadmin, so every domain router inherits it.
 *
 * Rollout flag ENFORCE_TENANT_CAPABILITIES (read at request time): `on` (default), `warn` (log the
 * denial and let the request through) and `off` (bypass).
 */
export function enforceTenantCapabilities(req, _res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (!req.user) return next();
  if (req.user.role === 'superadmin') return next();

  const mode = getEnforcementMode();
  if (mode === 'off') return next();

  // req.path is the pathname Express routes on. For an absolute-form request target (`POST http://x/api/v1/ots`)
  // req.originalUrl is the full URL and would not match any prefix.
  const pathname = String(req.path || '');
  const capability = findRequiredCapability(pathname);
  if (!capability) return next();

  const capabilities = normalizeCapabilities(req.tenant?.capabilities);
  if (capabilities[capability]) return next();

  const meta = {
    tenantId: req.tenantId ?? req.tenant?.tenantId ?? req.user.tenantId,
    userId: req.user.userId,
    method: req.method,
    path: pathname,
    capability,
  };

  if (mode === 'warn') {
    logger.warn('enforceTenantCapabilities: would deny (warn mode, request allowed)', meta);
    return next();
  }

  logger.warn('enforceTenantCapabilities: denied', meta);
  return next(
    new ApiError(
      403,
      'Tu organización no tiene habilitada esta función. Contacta a TIMTTO si necesitas activarla.',
      'CAPABILITY_DISABLED',
      { capability },
    ),
  );
}
