import { platformUserService } from '../services/platformUser.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

/**
 * PlatformUserController — pure binding for cross-tenant user operations.
 * No business logic. All logic lives in PlatformUserService.
 */
export class PlatformUserController {
  /**
   * GET /api/v1/platform/users
   * Query: page, limit, tenantId, role, email
   */
  static async list(req, res, next) {
    try {
      const { page = 1, limit = 20, tenantId, role, email } = req.query;

      const result = await platformUserService.list({
        page: Number(page),
        limit: Number(limit),
        tenantId,
        role,
        email,
      });

      return res
        .status(200)
        .json(successResponse(result.data, 'Usuarios recuperados', 200, result.pagination));
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/v1/platform/users/:userId/reset-password
   * Returns { temporaryPassword } ONE TIME — never stored in cleartext.
   */
  static async resetPassword(req, res, next) {
    try {
      const { userId } = req.params;

      const { temporaryPassword } = await platformUserService.resetPasswordCrossTenant(userId);

      return res.status(200).json(
        successResponse({ temporaryPassword }, 'Contraseña temporal generada. Compártela de forma segura.'),
      );
    } catch (err) {
      return next(err);
    }
  }
}

export const platformUserController = PlatformUserController;
