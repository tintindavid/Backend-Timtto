import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireSuperAdmin } from '../middlewares/superadmin.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { analyticsQuerySchema } from '../dtos/analyticsQuery.dto.js';
import { PlatformAnalyticsController } from '../controllers/platformAnalytics.controller.js';

const router = Router();

// All platform/analytics routes require SuperAdmin authentication.
// Middleware chain: authenticate → requireSuperAdmin → validate(query) → controller

/**
 * GET /api/v1/platform/analytics
 * Global KPIs + chart data in a single response.
 * Query: from (ISO date), to (ISO date)
 */
router.get(
  '/',
  authenticate,
  requireSuperAdmin,
  validate(analyticsQuerySchema, 'query'),
  PlatformAnalyticsController.summary,
);

/**
 * GET /api/v1/platform/analytics/tenants
 * Per-tenant breakdown table (array of rows with counts).
 * Query: from, to, includeDeleted
 */
router.get(
  '/tenants',
  authenticate,
  requireSuperAdmin,
  validate(analyticsQuerySchema, 'query'),
  PlatformAnalyticsController.tenants,
);

/**
 * GET /api/v1/platform/analytics/tenants.csv
 * Same dataset as /tenants but returned as a UTF-8 CSV file with BOM.
 * Query: from, to, includeDeleted
 */
router.get(
  '/tenants.csv',
  authenticate,
  requireSuperAdmin,
  validate(analyticsQuerySchema, 'query'),
  PlatformAnalyticsController.tenantsCsv,
);

export default router;
