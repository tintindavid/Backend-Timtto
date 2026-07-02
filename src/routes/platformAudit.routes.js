import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireSuperAdmin } from '../middlewares/superadmin.middleware.js';
import { PlatformAuditController } from '../controllers/platformAudit.controller.js';

const router = Router();

/**
 * GET /api/v1/platform/audit-log
 * Paginated audit log with optional filters.
 * Query: page, limit, actorUserId, action, targetTenantId, from, to
 * Results ordered timestamp DESC.
 */
router.get(
  '/',
  authenticate,
  requireSuperAdmin,
  PlatformAuditController.list,
);

export default router;
