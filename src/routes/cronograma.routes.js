import { Router } from 'express';
import { downloadCronogramaPDF, previewCronogramaHTML } from '../controllers/cronograma.controller.js';
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

router.post(
  '/preview',
  authenticate,
  authorize(PERMISSIONS.CRONOGRAMAS_PDF),
  extractUserId,
  validate(cronogramaPDFDto, 'body'),
  previewCronogramaHTML,
);

export default router;
