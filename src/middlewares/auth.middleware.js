'use strict';
import { verifyToken } from '../utils/jwt.util.js';
import { ApiError } from '../utils/apiError.util.js';
import { Role } from '../models/role.model.js';
import { User } from '../models/user.model.js';

/**
 * Authenticates the request via Bearer JWT and hydrates req.user with the
 * caller's live permission list.
 *
 * Why hydrate here (once) instead of inside authorize() (per endpoint):
 *   - A single Mongo lookup per request instead of one per protected route.
 *   - authorize() becomes a pure in-memory array check.
 *   - Editing a role invalidates on the very next request — no cache TTL to reason about.
 *
 * req.user shape after this middleware:
 *   { userId, role, roleId, tenantId, permissions: string[] }
 *
 * Rules:
 *   - Missing/invalid token → 401.
 *   - Valid token with no roleId → permissions = []. authorize() will 403 any
 *     protected route. This is intentional: users without an assigned role
 *     cannot act on business resources, only /auth/me and /auth/change-password
 *     (which don't require authorize()).
 *   - superadmin role (platform) bypasses tenant RBAC; permissions stay empty
 *     and platform routes gate on req.user.role === 'superadmin' separately.
 */
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || req.headers.Authorization;

  if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return next(new ApiError(401, 'Token de autenticación requerido', 'NO_TOKEN_PROVIDED'));
  }

  const token = header.split(' ')[1];
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    return next(err);
  }

  req.user = { ...decoded, permissions: [] };

  // Hydrate a user display name for audit/history writes. The JWT only carries
  // ids to keep it small, so we look this up here once per request instead of
  // hitting Mongo again inside every service that records an event.
  if (decoded.userId) {
    try {
      const userDoc = await User.findById(decoded.userId).select('firstName lastName email fullName fileFirma').lean();
      if (userDoc) {
        req.user.firstName = userDoc.firstName;
        req.user.lastName = userDoc.lastName;
        req.user.email = userDoc.email;
        req.user.userName = `${userDoc.firstName || ''} ${userDoc.lastName || ''}`.trim() || userDoc.email;
        req.user.fullName = userDoc.fullName || req.user.userName;
        req.user.fileFirma = userDoc.fileFirma || null;
      }
    } catch (err) {
      // Non-fatal: audit will fall back to "Sistema".
      req.user.userName = req.user.userName || null;
    }
  }

  if (decoded.roleId && decoded.tenantId) {
    try {
      const role = await Role.findOne({
        _id: decoded.roleId,
        tenantId: decoded.tenantId,
        isDeleted: false,
      })
        .select('permissions')
        .lean();
      if (role && Array.isArray(role.permissions)) {
        req.user.permissions = role.permissions;
      }
    } catch (err) {
      return next(err);
    }
  }

  return next();
}
