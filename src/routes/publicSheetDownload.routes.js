'use strict';
import { Router } from 'express';
import { publicSheetDownloadController } from '../controllers/publicSheetDownload.controller.js';
import { resolveSheetDownloadToken } from '../middlewares/resolveSheetDownloadToken.middleware.js';
import {
  clientPortalReadLimiter,
  clientPortalReadIpLimiter,
} from '../middlewares/rateLimiter.middleware.js';

const router = Router();

/**
 * Public download routes for one-off share links
 * (sheetwork-share-and-portal-widening). Same middleware chain as
 * /public/client-view — rate limiters BEFORE the token resolver so
 * unknown tokens still consume the limiter.
 */
router.get(
  '/:token',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveSheetDownloadToken,
  publicSheetDownloadController.get
);

router.get(
  '/:token/pdf',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveSheetDownloadToken,
  publicSheetDownloadController.downloadPdf
);

router.get(
  '/:token/reports.zip',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveSheetDownloadToken,
  publicSheetDownloadController.downloadReportsZip
);

export default router;
