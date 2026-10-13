import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

// Pre-authentication endpoints may carry a stale Authorization header (for example a
// leftover token of another tenant when someone switches accounts), so they are exempt.
const EXEMPT = new Set([
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/refresh-token',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/reset-password',
  'GET /api/v1/auth/validate-reset-token',
]);

const normalize = (value) => String(value ?? '').trim().toLowerCase();

/**
 * enforceTenantTokenMatch — binds authenticated non-superadmin requests to the tenant
 * signed in their JWT (spec: tenant-token-binding).
 *
 * Without this, the effective tenant came only from the client-controlled
 * `x-tenant-id` header, so a user of tenant A could read and write tenant B's data,
 * and omitting the header produced queries without any tenant filter.
 *
 * Rules (only when req.user exists, i.e. after tryAuthenticate):
 *   - superadmin: never rejected here (view-as targets a tenant through the header).
 *   - token without tenantId: 401 TOKEN_TENANT_MISSING.
 *   - header present and different from the token tenant (case-insensitive): 403
 *     FORBIDDEN_CROSS_TENANT.
 *   - header absent: nothing to do; tenantResolver falls back to the token's tenant.
 *
 * Placement in app.js: after tryAuthenticate and BEFORE tenantResolver, so a foreign
 * header is rejected without a database lookup (and the 404 TENANT_NOT_FOUND of the
 * resolver cannot be used to discover which tenants exist).
 *
 * Emergency switch: ENFORCE_TENANT_TOKEN_MATCH=off bypasses the rule and logs a warning.
 */
export function enforceTenantTokenMatch(req, _res, next) {
  const user = req.user;
  if (!user) return next();
  if (user.role === 'superadmin') return next();
  if (EXEMPT.has(`${req.method} ${req.path}`)) return next();

  const tokenTenant = normalize(user.tenantId);
  if (!tokenTenant) {
    logger.warn('enforceTenantTokenMatch: token without tenantId', {
      userId: user.userId,
      method: req.method,
      path: req.path,
    });
    return next(new ApiError(401, 'Sesión inválida. Inicia sesión de nuevo.', 'TOKEN_TENANT_MISSING'));
  }

  const rawHeader = req.headers['x-tenant-id'];
  const headerTenant = typeof rawHeader === 'string' ? normalize(rawHeader) : '';
  if (!headerTenant || headerTenant === tokenTenant) return next();

  if (process.env.ENFORCE_TENANT_TOKEN_MATCH === 'off') {
    logger.warn('enforceTenantTokenMatch: bypassed via ENFORCE_TENANT_TOKEN_MATCH=off', {
      userId: user.userId,
      tokenTenant,
      headerTenant,
      method: req.method,
      path: req.path,
    });
    return next();
  }

  logger.warn('enforceTenantTokenMatch: header tenant differs from token tenant', {
    userId: user.userId,
    tokenTenant,
    headerTenant,
    method: req.method,
    path: req.path,
  });
  return next(new ApiError(403, 'Acceso denegado a un tenant ajeno', 'FORBIDDEN_CROSS_TENANT'));
}
