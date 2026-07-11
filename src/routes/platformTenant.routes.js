import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireSuperAdmin } from '../middlewares/superadmin.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { uploadLogoOptional, handleMulterError } from '../middlewares/upload.middleware.js';
import { createTenantWithAdminSchema } from '../dtos/createTenantWithAdmin.dto.js';
import { suspendTenantSchema } from '../dtos/suspendTenant.dto.js';
import { updateTenantMetadataSchema } from '../dtos/updateTenantMetadata.dto.js';
import { PlatformTenantController } from '../controllers/platformTenant.controller.js';

const router = Router();

// All platform/tenants routes require SuperAdmin authentication.
// Middleware chain: authenticate → requireSuperAdmin → [validate] → controller

/**
 * Parses `tenant` and `admin` from JSON strings when the request comes as
 * multipart/form-data (i.e., includes a logo file). No-op for application/json
 * requests, which already have proper objects on req.body.
 */
function parseMultipartJsonFields(req, _res, next) {
  for (const field of ['tenant', 'admin']) {
    if (typeof req.body[field] === 'string') {
      try {
        req.body[field] = JSON.parse(req.body[field]);
      } catch {
        // Leave as string; validate() will surface a shape error.
      }
    }
  }
  next();
}

/**
 * POST /api/v1/platform/tenants
 * Creates a tenant + first admin user in a single atomic operation.
 * Accepts application/json or multipart/form-data (fields tenant, admin as
 * JSON strings + optional logo file).
 * Returns 201 { tenant, admin, temporaryPassword } — one-time.
 */
router.post(
  '/',
  authenticate,
  requireSuperAdmin,
  uploadLogoOptional,
  handleMulterError,
  parseMultipartJsonFields,
  validate(createTenantWithAdminSchema),
  PlatformTenantController.create,
);

/**
 * GET /api/v1/platform/tenants
 * Paginated list with optional filters: status, plan, search, includeDeleted.
 */
router.get(
  '/',
  authenticate,
  requireSuperAdmin,
  PlatformTenantController.list,
);

/**
 * GET /api/v1/platform/tenants/:id
 * Tenant detail + computed counters (usersCount, customersCount, equiposCount, otsAbiertas).
 */
router.get(
  '/:id',
  authenticate,
  requireSuperAdmin,
  PlatformTenantController.getById,
);

/**
 * PUT /api/v1/platform/tenants/:id
 * Updates editable metadata. Does NOT change tenantId, status, plan.
 * Accepts multipart/form-data for optional logo replacement.
 */
router.put(
  '/:id',
  authenticate,
  requireSuperAdmin,
  uploadLogoOptional,
  handleMulterError,
  validate(updateTenantMetadataSchema),
  PlatformTenantController.updateMetadata,
);

/**
 * PATCH /api/v1/platform/tenants/:id/suspend
 * Sets status='suspended'. Body: { reason }.
 */
router.patch(
  '/:id/suspend',
  authenticate,
  requireSuperAdmin,
  validate(suspendTenantSchema),
  PlatformTenantController.suspend,
);

/**
 * PATCH /api/v1/platform/tenants/:id/reactivate
 * Sets status='active'.
 */
router.patch(
  '/:id/reactivate',
  authenticate,
  requireSuperAdmin,
  PlatformTenantController.reactivate,
);

/**
 * DELETE /api/v1/platform/tenants/:id
 * Soft-delete. UI requires two-step confirmation. Returns 204.
 */
router.delete(
  '/:id',
  authenticate,
  requireSuperAdmin,
  PlatformTenantController.softDelete,
);

export default router;
