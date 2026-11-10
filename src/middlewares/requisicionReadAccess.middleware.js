import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { PERMISSIONS } from '../constants/permissions.js';

const has = (user, permission) => Array.isArray(user?.permissions) && user.permissions.includes(permission);

/** Same semantics as the controller's `canRead`: read permission, manage-all or superadmin. */
export const userCanReadRequisiciones = (user) => user?.role === 'superadmin'
  || has(user, PERMISSIONS.REQUISICIONES_MANAGE_ALL)
  || has(user, PERMISSIONS.REQUISICIONES_READ);

/**
 * Read gate for `GET /requisiciones/:id` and `GET /requisiciones?vista=mi-historial` (change: requisiciones-mi-historial).
 * Sets `req.canRead` and lets the request through even without `requisiciones:read`: the service then only returns what the
 * caller participated in (404 otherwise, never 403). A plain list (`allowWithoutRead` false for the request) still needs read.
 *
 * @param {(req: import('express').Request) => boolean} allowWithoutRead - true when the request may proceed without read
 */
export function authorizeReadOrParticipation(allowWithoutRead = () => true) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'No autenticado', 'NOT_AUTHENTICATED'));
    req.canRead = userCanReadRequisiciones(req.user);
    if (req.canRead || allowWithoutRead(req)) return next();
    logger.warn(`[RBAC] DENIED tenantId=${req.user.tenantId} userId=${req.user.userId} permission=${PERMISSIONS.REQUISICIONES_READ}`);
    return next(new ApiError(403, 'Permisos insuficientes', 'FORBIDDEN'));
  };
}

/**
 * Vistas of `GET /` that are scoped to the caller by the service itself (oc-por-aprobar: the OC the caller can decide, and
 * nothing unless he holds approve-po; mias: creator or requester of the caller;
 * por-confirmar: lines whose responsible is the caller, unless manage-all; mi-historial: own timeline events), so they
 * need no `requisiciones:read`. Strict string equality: arrays, duplicates or odd casings fail closed (403).
 */
export const SELF_SCOPED_VISTAS = Object.freeze(['mias', 'por-confirmar', 'mi-historial', 'oc-por-aprobar']);

/** `GET /` gate: read required unless the request asks for one of the caller's own (self-scoped) vistas. */
export const authorizeListOrMiHistorial = authorizeReadOrParticipation(
  (req) => (typeof req.query?.vista === 'string' && SELF_SCOPED_VISTAS.includes(req.query.vista))
    // E5: the tenant-wide list needs requisiciones:reports instead of read (enforced by the route and by the service).
    || req.query?.alcance === 'tenant',
);
