import { Router } from 'express';
import { downloadCronogramaPDF, previewCronogramaHTML } from '../controllers/cronograma.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { extractUserId } from '../middlewares/extractUserId.middleware.js';
import { cronogramaPDFDto } from '../dtos/cronograma.dto.js';

const router = Router();

/**
 * @route POST /api/v1/cronogramas/pdf
 * @desc Generar y descargar PDF del cronograma
 * @access Private
 */
router.post(
  '/pdf', 
  authenticate, 
  extractUserId, // Agregar middleware
  validate(cronogramaPDFDto, 'body'), 
  downloadCronogramaPDF
);

/**
 * @route POST /api/v1/cronogramas/preview
 * @desc Vista previa HTML del cronograma (solo desarrollo)
 * @access Private
 */
router.post(
  '/preview', 
  authenticate, 
  extractUserId, // Agregar middleware
  validate(cronogramaPDFDto, 'body'), 
  previewCronogramaHTML
);

export default router;
