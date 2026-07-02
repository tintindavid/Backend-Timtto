import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireSuperAdmin } from '../middlewares/superadmin.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { resetPasswordCrossTenantSchema } from '../dtos/resetPasswordCrossTenant.dto.js';
import { PlatformUserController } from '../controllers/platformUser.controller.js';

const router = Router();

// All routes require SuperAdmin authentication.
// Chain: authenticate → requireSuperAdmin → [validate] → controller

/**
 * GET /api/v1/platform/users
 * Cross-tenant paginated user list.
 * Query: page, limit, tenantId, role, email
 */
router.get(
  '/',
  authenticate,
  requireSuperAdmin,
  PlatformUserController.list,
);

/**
 * POST /api/v1/platform/users/:userId/reset-password
 * Generates a temporary password for the target user and sets mustChangePassword=true.
 * Returns { temporaryPassword } ONE TIME.
 * The auditPlatformAction middleware writes USER_PASSWORD_RESET post-response.
 */
router.post(
  '/:userId/reset-password',
  authenticate,
  requireSuperAdmin,
  validate(resetPasswordCrossTenantSchema),
  PlatformUserController.resetPassword,
);

export default router;
