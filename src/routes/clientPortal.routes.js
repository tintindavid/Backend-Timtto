'use strict';
import { Router } from 'express';
import { clientPortalController } from '../controllers/clientPortal.controller.js';
import { resolveClientToken } from '../middlewares/resolveClientToken.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { clientPortalSignDto, clientPortalLateSignDto } from '../dtos/clientPortalSign.dto.js';
import Joi from 'joi';
import { CLIENT_NOTE_MAX_LENGTH } from '../constants/clientPortal.constants.js';

const clientNoteDto = Joi.object({
  text: Joi.string().allow('').max(CLIENT_NOTE_MAX_LENGTH).required(),
}).unknown(false);
import {
  clientPortalReadLimiter,
  clientPortalReadIpLimiter,
} from '../middlewares/rateLimiter.middleware.js';

const router = Router();

/**
 * Public client-portal routes — no login, gated only by the opaque token in
 * the URL. Mounted at /api/public/client-view (see app.js), BEFORE any
 * route-level `authenticate` requirement.
 *
 * IMPORTANT: rate limiters MUST run BEFORE resolveClientToken. Otherwise an
 * unknown/revoked token short-circuits with res.status(404|410).json(...) and
 * Express never invokes the limiters — enabling unlimited token guessing and
 * DB hits (security-auditor Finding 1, blocking). Both limiters key on
 * req.params.token / req.ip, which Express extracts BEFORE any middleware
 * runs, so they work correctly at this position.
 * Chain:
 *   clientPortalReadIpLimiter -> clientPortalReadLimiter -> resolveClientToken -> controller
 */
router.get(
  '/:token',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  clientPortalController.getConsolidated
);

router.get(
  '/:token/reports/:reportId',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  clientPortalController.getReportDetail
);

// text/html — feeds the client-portal ReportDetailModal iframe with the same
// document the client will receive as PDF at handover (product decision to
// avoid a UI approximation feeling like a "different" report).
router.get(
  '/:token/reports/:reportId/pdf-view',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  clientPortalController.getReportPdfView
);

// Below: change B (client-portal-review-and-sign) — review toggle, sign,
// and sheets history/PDF. Same locked-in chain: ipLimiter -> tokenLimiter ->
// resolveClientToken -> [validate] -> controller.

router.post(
  '/:token/reports/:reportId/review',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  clientPortalController.markReviewed
);

router.delete(
  '/:token/reports/:reportId/review',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  clientPortalController.unmarkReviewed
);

// Free-form note the client attaches to a report (2026-08-02). Same chain,
// PUT semantics: empty text clears the note ($unset); non-empty overwrites.
router.put(
  '/:token/reports/:reportId/note',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  validate(clientNoteDto, 'body'),
  clientPortalController.updateClientNote
);

router.post(
  '/:token/sign',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  validate(clientPortalSignDto, 'body'),
  clientPortalController.sign
);

// Read-only preview of the N HTs the client is about to sign. Same DTO
// (imagePng may be empty here so the client can preview before drawing).
router.post(
  '/:token/sign-preview',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  clientPortalController.signPreview
);

router.get(
  '/:token/sheets',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  clientPortalController.getSheets
);

router.get(
  '/:token/sheets/:sheetId/pdf',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  clientPortalController.getSheetPdf
);

// Late-sign a sheet whose `firmaFile` is still empty (design D3/D7). Same
// rate-limiter chain as `/sign` — this repo has no dedicated write limiter,
// the read limiters double as the write gate for every portal mutation.
router.post(
  '/:token/sheets/:sheetId/sign',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  validate(clientPortalLateSignDto, 'body'),
  clientPortalController.signExistingSheet
);

// ZIP with one PDF per report of a signed sheet (2026-08-04). Same
// token+sheet scoping as the sheet PDF endpoint above — client sees only
// the reports that ended up in a hoja they themselves signed under THIS
// access token.
router.get(
  '/:token/sheets/:sheetId/reports-pdf',
  clientPortalReadIpLimiter,
  clientPortalReadLimiter,
  resolveClientToken,
  clientPortalController.getSheetReportsZip
);

export default router;
