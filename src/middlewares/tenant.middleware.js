import { ApiError } from '../utils/apiError.util.js';
import { Tenant } from '../models/tenant.model.js';
import { env } from '../config/env.js';

/**
 * tenantResolver — resolves and validates the tenantId for every request.
 *
 * Resolution priority (trusted sources only):
 *   1. Header `x-tenant-id`
 *   2. req.user.tenantId (from JWT)
 *
 * req.body.tenantId is intentionally IGNORED (invariant from constitution P1).
 *
 * SuperAdmin users (role === 'superadmin') bypass the existence check so they
 * can act on any tenant without a lookup — E2 "view-as" depends on this.
 *
 * On success sets:
 *   - req.tenantId  {string}  lowercase tenantId
 *   - req.tenant    {object}  { tenantId, status } for downstream enforcement
 */
export async function tenantResolver(req, res, next) {
  try {
    const rawHeader = req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'];
    let tenantId = null;

    if (rawHeader && typeof rawHeader === 'string' && rawHeader.trim()) {
      tenantId = rawHeader.trim().toLowerCase();
    } else if (req.user?.tenantId) {
      tenantId = req.user.tenantId;
    }

    if (!tenantId) {
      // No tenantId source present — allow the request to continue.
      // Routes that require a tenant will enforce it via authenticate + tenantId check.
      return next();
    }

    // SuperAdmin users carry tenantId='__platform__'.
    // They are allowed to resolve any tenant supplied in the header;
    // if no header is present their own sentinel is kept and the DB lookup is skipped.
    if (req.user?.role === 'superadmin') {
      req.tenantId = tenantId;
      req.tenant = { tenantId, status: 'active' };
      return next();
    }

    // Platform sentinel — used before req.user exists (e.g., SuperAdmin login).
    // '__platform__' is reserved by the DTO and has no matching Tenant document,
    // so bypass the DB lookup. Downstream services filter by tenantId anyway,
    // so a non-superadmin sending this header will only see empty results.
    if (tenantId === '__platform__') {
      req.tenantId = tenantId;
      req.tenant = { tenantId, status: 'active' };
      return next();
    }

    // Single query — the spec mandates exactly one DB call per request.
    const tenant = await Tenant.findOne(
      { tenantId },
      { tenantId: 1, status: 1 },
    ).lean();

    if (!tenant) {
      return next(new ApiError(404, 'Tenant no encontrado', 'TENANT_NOT_FOUND'));
    }

    req.tenantId = tenant.tenantId;
    req.tenant = { tenantId: tenant.tenantId, status: tenant.status };

    // Enforcement of Tenant.status (design D3).
    // Activated via env.ENFORCE_TENANT_STATUS=true after a 7-day observation window.
    // Routes under /api/v1/platform/* are always exempt (SuperAdmin must be able to
    // reactivate tenants from the platform console).
    if (
      env.ENFORCE_TENANT_STATUS &&
      tenant.status !== 'active' &&
      !req.path.startsWith('/api/v1/platform/')
    ) {
      const code = `TENANT_${tenant.status.toUpperCase()}`;
      const messages = {
        suspended: 'Tu organización está temporalmente suspendida. Contacta a TIMTTO.',
        closed: 'Tu organización ha sido cerrada. Contacta a TIMTTO.',
      };
      const message = messages[tenant.status] || 'Tu organización no está activa.';
      return next(new ApiError(403, message, code));
    }

    return next();
  } catch (err) {
    return next(new ApiError(500, 'Error resolviendo tenant', 'TENANT_RESOLUTION_FAILED'));
  }
}
