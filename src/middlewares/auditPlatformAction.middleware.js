import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { Tenant } from '../models/tenant.model.js';
import { platformAuditLogService } from '../services/platformAuditLog.service.js';
import { logger } from '../config/logger.config.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Maps (HTTP method + URL path) to a PLATFORM_AUDIT_ACTIONS value.
 * Returns null when the route is not a known auditable platform action.
 *
 * @param {string} method - e.g. 'POST'
 * @param {string} urlPath - req.originalUrl stripped of query string
 */
function resolveAction(method, urlPath) {
  if (method === 'POST' && /\/platform\/tenants\/?$/.test(urlPath)) return 'TENANT_CREATED';
  if (method === 'PUT' && /\/platform\/tenants\/[^/]+\/?$/.test(urlPath)) return 'TENANT_UPDATED';
  if (method === 'PATCH' && /\/platform\/tenants\/[^/]+\/suspend\/?$/.test(urlPath)) return 'TENANT_SUSPENDED';
  if (method === 'PATCH' && /\/platform\/tenants\/[^/]+\/reactivate\/?$/.test(urlPath)) return 'TENANT_REACTIVATED';
  if (method === 'DELETE' && /\/platform\/tenants\/[^/]+\/?$/.test(urlPath)) return 'TENANT_SOFT_DELETED';
  if (method === 'POST' && /\/platform\/users\/[^/]+\/reset-password\/?$/.test(urlPath)) return 'USER_PASSWORD_RESET';
  if (method === 'POST' && /\/platform\/view-as\/?$/.test(urlPath)) return 'VIEW_AS_ENTERED';
  if (method === 'DELETE' && /\/platform\/view-as\/?$/.test(urlPath)) return 'VIEW_AS_EXITED';
  return null;
}

function resolveTargetType(action) {
  if (action === 'USER_PASSWORD_RESET') return 'user';
  return 'tenant';
}

/**
 * Extracts the MongoDB _id string from a platform tenant URL.
 * e.g. /api/v1/platform/tenants/6645abc → '6645abc'
 */
function extractTenantMongoId(urlPath) {
  const m = urlPath.match(/\/platform\/tenants\/([^/]+)/);
  return m ? m[1] : null;
}

/**
 * Extracts the userId string from a platform user URL.
 * e.g. /api/v1/platform/users/6645abc/reset-password → '6645abc'
 */
function extractUserMongoId(urlPath) {
  const m = urlPath.match(/\/platform\/users\/([^/]+)/);
  return m ? m[1] : null;
}

/**
 * Captures the document state BEFORE the platform action modifies it.
 * Returns null when there is no meaningful pre-state (creates, view-as).
 */
async function captureBeforeState(action, urlPath) {
  try {
    if (['TENANT_UPDATED', 'TENANT_SUSPENDED', 'TENANT_REACTIVATED', 'TENANT_SOFT_DELETED'].includes(action)) {
      const tenantMongoId = extractTenantMongoId(urlPath);
      if (tenantMongoId && mongoose.isValidObjectId(tenantMongoId)) {
        return Tenant.findById(tenantMongoId).lean();
      }
    }
    if (action === 'USER_PASSWORD_RESET') {
      const userId = extractUserMongoId(urlPath);
      if (userId && mongoose.isValidObjectId(userId)) {
        return User.findById(userId).select('-password').lean();
      }
    }
  } catch (err) {
    logger.error('auditPlatformAction: captureBeforeState error', { action, error: err.message });
  }
  return null;
}

/**
 * Captures the document state AFTER the platform action has executed.
 * Called inside res.on('finish'), so the DB is already in the new state.
 */
async function captureAfterState(action, urlPath) {
  try {
    if (['TENANT_UPDATED', 'TENANT_SUSPENDED', 'TENANT_REACTIVATED', 'TENANT_SOFT_DELETED'].includes(action)) {
      const tenantMongoId = extractTenantMongoId(urlPath);
      if (tenantMongoId && mongoose.isValidObjectId(tenantMongoId)) {
        // Use includeDeleted so soft-deleted docs are still visible.
        return Tenant.findById(tenantMongoId).setOptions({ includeDeleted: true }).lean();
      }
    }
  } catch (err) {
    logger.error('auditPlatformAction: captureAfterState error', { action, error: err.message });
  }
  return null;
}

/**
 * Resolves the MongoDB ObjectId of the affected document.
 * For creates, extracts from captured response body.
 * For updates/deletes/user-reset, extracts from the URL.
 * For view-as, looks up the tenant by tenantId string.
 *
 * @param {string} action
 * @param {string} urlPath
 * @param {object|null} capturedBody - parsed response body (from res.json interception)
 * @param {string|null} tenantIdFromBody - req.body.tenantId (view-as enter)
 * @param {string|null} tenantIdFromHeader - x-tenant-id header (view-as exit)
 */
async function resolveTargetId(action, urlPath, capturedBody, tenantIdFromBody, tenantIdFromHeader) {
  try {
    if (action === 'TENANT_CREATED') {
      // Extract from response body: { data: { tenant: { _id } } } or { data: { _id } }
      const id = capturedBody?.data?.tenant?._id ?? capturedBody?.data?._id;
      if (id && mongoose.isValidObjectId(id)) return new mongoose.Types.ObjectId(id);
      return null;
    }

    if (['TENANT_UPDATED', 'TENANT_SUSPENDED', 'TENANT_REACTIVATED', 'TENANT_SOFT_DELETED'].includes(action)) {
      const tenantMongoId = extractTenantMongoId(urlPath);
      if (tenantMongoId && mongoose.isValidObjectId(tenantMongoId)) {
        return new mongoose.Types.ObjectId(tenantMongoId);
      }
      return null;
    }

    if (action === 'USER_PASSWORD_RESET') {
      const userId = extractUserMongoId(urlPath);
      if (userId && mongoose.isValidObjectId(userId)) return new mongoose.Types.ObjectId(userId);
      return null;
    }

    if (action === 'VIEW_AS_ENTERED' && tenantIdFromBody) {
      const t = await Tenant.findOne({ tenantId: tenantIdFromBody }).select('_id').lean();
      return t ? t._id : null;
    }

    if (action === 'VIEW_AS_EXITED') {
      const tenantIdStr = tenantIdFromHeader;
      if (tenantIdStr && tenantIdStr !== '__platform__') {
        const t = await Tenant.findOne({ tenantId: tenantIdStr }).select('_id').lean();
        return t ? t._id : null;
      }
      return null;
    }
  } catch (err) {
    logger.error('auditPlatformAction: resolveTargetId error', { action, error: err.message });
  }
  return null;
}

/**
 * Resolves the string tenantId of the affected tenant for audit correlation.
 */
async function resolveTargetTenantId(action, urlPath, capturedBody, tenantIdFromBody, tenantIdFromHeader, beforeState) {
  // For tenant operations, we can extract from before-state or response body.
  if (['TENANT_SUSPENDED', 'TENANT_REACTIVATED', 'TENANT_SOFT_DELETED', 'TENANT_UPDATED'].includes(action)) {
    return beforeState?.tenantId ?? null;
  }
  if (action === 'TENANT_CREATED') {
    return capturedBody?.data?.tenant?.tenantId ?? capturedBody?.data?.tenantId ?? null;
  }
  if (action === 'USER_PASSWORD_RESET') {
    // beforeState here is the user doc; it has tenantId.
    return beforeState?.tenantId ?? null;
  }
  if (action === 'VIEW_AS_ENTERED') return tenantIdFromBody ?? null;
  if (action === 'VIEW_AS_EXITED') return tenantIdFromHeader ?? null;
  return null;
}

/**
 * auditPlatformAction — global post-response middleware for SuperAdmin audit logging.
 *
 * Placement in app.js: AFTER global auth (tryAuthenticate), BEFORE platform routes.
 *
 * Behaviour:
 * 1. Skips GET requests and non-platform paths.
 * 2. Captures the "before" document state (pre-controller).
 * 3. Intercepts res.json to capture the response body (for create targetId).
 * 4. On res.on('finish'), if status < 400: writes a PlatformAuditLog entry.
 *    The write is async and fail-silent (errors logged, never thrown).
 */
export function auditPlatformAction(req, res, next) {
  // Fast path: skip non-mutating methods immediately.
  if (!MUTATING_METHODS.has(req.method)) return next();

  const urlPath = req.originalUrl.split('?')[0];

  // Fast path: skip non-platform paths.
  if (!urlPath.includes('/platform/')) return next();

  const action = resolveAction(req.method, urlPath);
  if (!action) return next();

  // Run the async setup and then call next(). Errors are caught and logged;
  // they never surface to the client (fail-silent by design — D3).
  _setupAuditHook(req, res, action, urlPath).catch((err) => {
    logger.error('auditPlatformAction: setup error', { action, error: err.message });
  }).finally(() => {
    next();
  });
}

async function _setupAuditHook(req, res, action, urlPath) {
  // Capture actor email from DB (JWT payload does not include email).
  let actorEmail = 'unknown';
  const actorUserId = req.user?.userId || req.user?.id || null;
  if (actorUserId) {
    try {
      const actorUser = await User.findById(actorUserId).select('email').lean();
      if (actorUser?.email) actorEmail = actorUser.email;
    } catch (err) {
      logger.error('auditPlatformAction: failed to fetch actor email', { actorUserId, error: err.message });
    }
  }

  // Capture "before" document state (null for creates and view-as operations).
  const beforeState = await captureBeforeState(action, urlPath);

  // Snapshot values needed for the finish handler (captured before controller runs).
  const tenantIdFromBody = req.body?.tenantId ?? null;
  const tenantIdFromHeader = req.headers?.['x-tenant-id'] ?? null;

  // Intercept res.json to capture the serialised response body.
  let capturedBody = null;
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    capturedBody = body;
    return originalJson(body);
  };

  // --- Post-response hook ---
  res.on('finish', () => {
    // Only audit successful operations (status < 400).
    if (res.statusCode >= 400) return;

    // Run async resolution and write without blocking the response.
    (async () => {
      try {
        const [afterState, targetId, targetTenantId] = await Promise.all([
          captureAfterState(action, urlPath),
          resolveTargetId(action, urlPath, capturedBody, tenantIdFromBody, tenantIdFromHeader),
          resolveTargetTenantId(action, urlPath, capturedBody, tenantIdFromBody, tenantIdFromHeader, beforeState),
        ]);

        await platformAuditLogService.log({
          actorUserId,
          actorEmail,
          action,
          targetType: resolveTargetType(action),
          targetId,
          targetTenantId,
          before: beforeState,
          after: afterState,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          timestamp: new Date(),
        });
      } catch (err) {
        logger.error('auditPlatformAction: finish handler error', { action, error: err.message });
      }
    })();
  });
}
