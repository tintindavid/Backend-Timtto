import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { successResponse } from '../utils/apiResponse.util.js';

/**
 * PlatformViewAsController — SuperAdmin "view as tenant" session management.
 *
 * The backend does NOT maintain view-as session state — that is entirely the
 * frontend's responsibility (sessionStorage). The backend endpoints exist to:
 *   1. Validate the target tenant exists and is not deleted (enter).
 *   2. Provide an audit hook point for the auditPlatformAction middleware.
 *   3. Signal clean exit (204 on DELETE).
 */
export class PlatformViewAsController {
  /**
   * POST /api/v1/platform/view-as
   * Body: { tenantId } (validated by viewAsEnterSchema)
   *
   * Validates the target tenant exists (not deleted, not __platform__).
   * Returns minimal tenant info for the frontend banner.
   * The auditPlatformAction middleware writes VIEW_AS_ENTERED post-response.
   */
  static async enter(req, res, next) {
    try {
      const { tenantId } = req.body;

      const tenant = await Tenant.findOne({ tenantId }).lean();
      if (!tenant) {
        return next(
          new ApiError(404, `Tenant '${tenantId}' no encontrado`, 'TENANT_NOT_FOUND', { tenantId }),
        );
      }

      return res.status(200).json(
        successResponse(
          { tenant: { tenantId: tenant.tenantId, name: tenant.name } },
          `Modo view-as activado para ${tenant.name}`,
        ),
      );
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/v1/platform/view-as
   *
   * Signals exit from view-as mode. The frontend clears sessionStorage.
   * The auditPlatformAction middleware writes VIEW_AS_EXITED post-response.
   * Returns 204 No Content.
   */
  static async exit(req, res, next) {
    try {
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  }
}

export const platformViewAsController = PlatformViewAsController;
