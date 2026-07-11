import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireSuperAdmin } from '../middlewares/superadmin.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { viewAsEnterSchema } from '../dtos/viewAsEnter.dto.js';
import { PlatformViewAsController } from '../controllers/platformViewAs.controller.js';

const router = Router();

/**
 * POST /api/v1/platform/view-as
 * Activates view-as mode for the given tenantId.
 * Validates tenant exists (not deleted, not __platform__).
 * Returns { tenant: { tenantId, name } } for the frontend banner.
 * auditPlatformAction middleware writes VIEW_AS_ENTERED post-response.
 */
router.post(
  '/',
  authenticate,
  requireSuperAdmin,
  validate(viewAsEnterSchema),
  PlatformViewAsController.enter,
);

/**
 * DELETE /api/v1/platform/view-as
 * Signals exit from view-as mode. Returns 204.
 * auditPlatformAction middleware writes VIEW_AS_EXITED post-response.
 */
router.delete(
  '/',
  authenticate,
  requireSuperAdmin,
  PlatformViewAsController.exit,
);

export default router;
