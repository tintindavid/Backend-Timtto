'use strict';

import { History } from '../models/history.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';

/**
 * Best-effort recording of an activity entry. Callers are business services,
 * so a failed write here MUST NOT break the actual operation — we catch and
 * log instead of throwing. Use `throwOnError: true` in tests when you need
 * loud failures.
 */
async function record(entry, options = {}) {
  const { throwOnError = false } = options;
  try {
    if (!entry?.tenantId) throw new Error('tenantId is required for history entries');
    if (!entry?.resourceType) throw new Error('resourceType is required');
    if (!entry?.resourceId) throw new Error('resourceId is required');
    if (!entry?.action) throw new Error('action is required');
    if (!entry?.description) throw new Error('description is required');
    await History.create({
      tenantId: entry.tenantId,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      action: entry.action,
      description: entry.description,
      userId: entry.userId || null,
      userName: entry.userName || 'Sistema',
      changes: entry.changes || null,
      metadata: entry.metadata || null,
    });
  } catch (err) {
    logger.warn(`[history] failed to record: ${err.message}`, { entry });
    if (throwOnError) throw err;
  }
}

export class HistoryService {
  /**
   * Records an activity entry. See `record()` for the shape.
   * Delegates to the internal helper so the service and direct callers share
   * the same failure semantics.
   */
  async record(entry, options) {
    return record(entry, options);
  }

  /**
   * Timeline for a single resource. Latest events first.
   * Pagination is optional — most consumers just want the last 100 or so.
   */
  async listByResource(resourceType, resourceId, tenantId, { page = 1, limit = 100 } = {}) {
    try {
      requireTenant(tenantId);
      if (!resourceType) throw new ApiError(400, 'resourceType requerido', 'INVALID_QUERY');
      if (!resourceId) throw new ApiError(400, 'resourceId requerido', 'INVALID_QUERY');

      const query = applyTenantFilter({ resourceType, resourceId }, tenantId);
      const skip = (Number(page) - 1) * Number(limit);
      const [data, total] = await Promise.all([
        History.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
        History.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error listando historial:', err);
      throw new ApiError(500, 'Error listando historial', 'LIST_HISTORY_ERROR');
    }
  }
}

export const historyService = new HistoryService();
