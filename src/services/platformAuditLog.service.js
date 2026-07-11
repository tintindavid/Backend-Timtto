import { PlatformAuditLog } from '../models/platformAuditLog.model.js';
import { logger } from '../config/logger.config.js';

/**
 * PlatformAuditLogService — read and write platform audit log entries.
 *
 * Write operations are fail-silent (`.catch(logger.error)`) so a logging
 * failure never interrupts the primary platform operation.
 */
export class PlatformAuditLogService {
  /**
   * Persist one audit entry asynchronously.
   * The caller MUST NOT await this if fail-silent semantics are required.
   * Errors are swallowed and forwarded to the logger.
   *
   * @param {object} entry - Fields matching PlatformAuditLog schema.
   */
  async log(entry) {
    return PlatformAuditLog.create(entry).catch((err) =>
      logger.error('PlatformAuditLog: failed to persist entry', {
        action: entry.action,
        actorUserId: entry.actorUserId,
        error: err.message,
      }),
    );
  }

  /**
   * Paginated list with optional filters.
   *
   * @param {object} params
   * @param {number}  [params.page=1]
   * @param {number}  [params.limit=20]
   * @param {string}  [params.actorUserId]
   * @param {string}  [params.action]
   * @param {string}  [params.targetTenantId]
   * @param {string}  [params.from] - ISO date string (inclusive lower bound on timestamp)
   * @param {string}  [params.to]   - ISO date string (inclusive upper bound on timestamp)
   */
  async list({ page = 1, limit = 20, actorUserId, action, targetTenantId, from, to } = {}) {
    const filter = {};

    if (actorUserId) filter.actorUserId = actorUserId;
    if (action) filter.action = action;
    if (targetTenantId) filter.targetTenantId = targetTenantId;

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(Math.max(1, Number(limit)), 100);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      PlatformAuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PlatformAuditLog.countDocuments(filter),
    ]);

    const pages = Math.ceil(total / limitNum) || 1;

    return {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages,
        hasNext: pageNum < pages,
        hasPrev: pageNum > 1,
      },
    };
  }
}

export const platformAuditLogService = new PlatformAuditLogService();
