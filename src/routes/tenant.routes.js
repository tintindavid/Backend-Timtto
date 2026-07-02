import { Router } from 'express';
import { TenantController } from '../controllers/tenant.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireSuperAdmin } from '../middlewares/superadmin.middleware.js';
import { requireTenantMatch } from '../middlewares/requireTenantMatch.middleware.js';
import { uploadLogoOptional, handleMulterError } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createTenantSchema } from '../dtos/createTenant.dto.js';
import { updateTenantSchema } from '../dtos/updateTenant.dto.js';

const router = Router();

// Deprecation headers middleware — applied to all legacy /api/v1/tenants/* routes.
// Successor: /api/v1/platform/tenants (E1 of SaaS Evolution Programme).
const SUNSET_DATE = process.env.TENANT_ROUTES_SUNSET_DATE || '2026-08-01T00:00:00Z';

function deprecationHeaders(_req, res, next) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', SUNSET_DATE);
  res.setHeader('Link', '</api/v1/platform/tenants>; rel="successor-version"');
  return next();
}

// SuperAdmin-only sub-routes (read-only helpers — no deprecation headers needed on these
// since they are superadmin internal paths, not legacy public paths).
router.get('/superadmin/all', authenticate, requireSuperAdmin, TenantController.listAllForSuperAdmin);
router.get('/superadmin/:id', authenticate, requireSuperAdmin, TenantController.getAnyTenant);

// Legacy routes — all now hardened and decorated with Deprecation headers.

// POST / — create tenant; was public, now requires superadmin.
router.post(
  '/',
  deprecationHeaders,
  authenticate,
  requireSuperAdmin,
  uploadLogoOptional,
  handleMulterError,
  validate(createTenantSchema),
  TenantController.create,
);

// GET / — list all tenants; was any-authenticated, now requires superadmin.
router.get(
  '/',
  deprecationHeaders,
  authenticate,
  requireSuperAdmin,
  TenantController.list,
);

// GET /:id — own tenant or superadmin.
router.get(
  '/:id',
  deprecationHeaders,
  authenticate,
  requireTenantMatch,
  TenantController.get,
);

// PUT /:id — own tenant or superadmin.
router.put(
  '/:id',
  deprecationHeaders,
  authenticate,
  requireTenantMatch,
  uploadLogoOptional,
  handleMulterError,
  validate(updateTenantSchema),
  TenantController.update,
);

// DELETE /:id — superadmin only.
router.delete(
  '/:id',
  deprecationHeaders,
  authenticate,
  requireSuperAdmin,
  TenantController.remove,
);

export default router;
