'use strict';
import { Router } from 'express';
import { publicSheetSignController } from '../controllers/publicSheetSign.controller.js';
import { resolveSheetSignToken } from '../middlewares/resolveSheetSignToken.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { publicSheetSignDto } from '../dtos/publicSheetSign.dto.js';
import {
  clientPortalReadLimiter,
  clientPortalReadIpLimiter,
} from '../middlewares/rateLimiter.middleware.js';

const router = Router();

/**
 * Public sheet-sign routes — no login, gated by the opaque token in the URL.
 * Mounted at /public/sheet-sign BEFORE any route-level authenticate (see
 * app.js), just like /public/client-view.
 *
 * Rate limiters MUST run BEFORE resolveSheetSignToken so that unknown
 * tokens still consume the limiter (portal security-auditor Finding 1).
 */

router.get(
  '/:token',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveSheetSignToken,
  publicSheetSignController.get
);

router.post(
  '/:token',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveSheetSignToken,
  validate(publicSheetSignDto, 'body'),
  publicSheetSignController.sign
);

export default router;
