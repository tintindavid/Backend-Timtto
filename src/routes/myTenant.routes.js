import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { requireRole } from '../middlewares/requireRole.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { uploadLogoOptional, handleMulterError } from '../middlewares/upload.middleware.js';
import { updateTenantMetadataSchema } from '../dtos/updateTenantMetadata.dto.js';
import { MyTenantController } from '../controllers/myTenant.controller.js';

const router = Router();

/**
 * GET /api/v1/my-tenant
 * Returns the tenant belonging to the authenticated user.
 * Available to any authenticated user (all roles).
 */
router.get('/', authenticate, authorize(PERMISSIONS.MY_TENANT_READ), MyTenantController.get);

/**
 * GET /api/v1/my-tenant/capabilities
 * Capability flags, derived type and organization client of the effective tenant.
 * Only authentication is required (NO RBAC permission): every role needs it to render the UI.
 */
router.get('/capabilities', authenticate, MyTenantController.getCapabilities);

/**
 * PUT /api/v1/my-tenant
 * Updates editable metadata of the user's own tenant.
 * Restricted to role='admin'. Technicians and regular users receive 403.
 * Accepts multipart/form-data for optional logo replacement.
 */
router.put(
  '/',
  authenticate,
  authorize(PERMISSIONS.MY_TENANT_UPDATE),
  requireRole('admin'),
  uploadLogoOptional,
  handleMulterError,
  validate(updateTenantMetadataSchema),
  MyTenantController.update,
);

export default router;
