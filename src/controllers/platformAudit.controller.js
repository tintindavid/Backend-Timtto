import { platformAuditLogService } from '../services/platformAuditLog.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

/**
 * PlatformAuditController — pure binding for audit log queries.
 */
export class PlatformAuditController {
  /**
   * GET /api/v1/platform/audit-log
   * Query: page, limit, actorUserId, action, targetTenantId, from, to
   *
   * Results are ordered by timestamp DESC (most recent first).
   */
  static async list(req, res, next) {
    try {
      const { page = 1, limit = 20, actorUserId, action, targetTenantId, from, to } = req.query;

      const result = await platformAuditLogService.list({
        page: Number(page),
        limit: Number(limit),
        actorUserId,
        action,
        targetTenantId,
        from,
        to,
      });

      return res
        .status(200)
        .json(successResponse(result.data, 'Audit log recuperado', 200, result.pagination));
    } catch (err) {
      return next(err);
    }
  }
}

export const platformAuditController = PlatformAuditController;
