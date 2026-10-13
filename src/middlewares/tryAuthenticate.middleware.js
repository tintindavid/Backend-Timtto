import { verifyToken } from '../utils/jwt.util.js';

/**
 * tryAuthenticate — silently parses the JWT (if present and valid) into req.user so
 * that the global middlewares that run before route-level `authenticate`
 * (tenantResolver, enforceTenantTokenMatch, enforceMustChangePassword,
 * enforceReadOnlyForSuperadmin, auditPlatformAction) can inspect it.
 *
 * It does NOT enforce authentication: invalid or expired tokens are ignored and
 * route-level `authenticate` surfaces the correct 401 where auth is required.
 */
export function tryAuthenticate(req, _res, next) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (header && typeof header === 'string' && header.startsWith('Bearer ')) {
    try {
      const decoded = verifyToken(header.split(' ')[1]);
      if (!req.user) req.user = decoded; // do not overwrite if already set
    } catch (_) {
      // Ignored on purpose; see the doc comment above.
    }
  }
  next();
}
