import { Router } from 'express';
import { downloadCronogramaPDF, downloadCronogramaExcel, previewCronogramaHTML } from '../controllers/cronograma.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { extractUserId } from '../middlewares/extractUserId.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { cronogramaPDFDto } from '../dtos/cronograma.dto.js';

const router = Router();

router.post(
  '/pdf',
  authenticate,
  authorize(PERMISSIONS.CRONOGRAMAS_PDF),
  extractUserId,
  validate(cronogramaPDFDto, 'body'),
  downloadCronogramaPDF,
);

// Excel counterpart of /pdf — same body contract (cronogramaPDFDto is
// format-agnostic: clienteId + filtros). Gated on equipo-items:read per
// cronograma-excel-por-filtros spec (deliberately distinct from the PDF
// route's cronogramas:pdf permission).
router.post(
  '/excel',
  authenticate,
  authorize(PERMISSIONS.EQUIPO_ITEMS_READ),
  extractUserId,
  validate(cronogramaPDFDto, 'body'),
  downloadCronogramaExcel,
);

router.post(
  '/preview',
  authenticate,
  authorize(PERMISSIONS.CRONOGRAMAS_PDF),
  extractUserId,
  validate(cronogramaPDFDto, 'body'),
  previewCronogramaHTML,
);

export default router;
