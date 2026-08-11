'use strict';
import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { generateBulkPDFs, generateSinglePDF, checkMicroserviceHealth } from '../controllers/pdfReports.controller.js';
import { bulkPdfReportsDto } from '../dtos/bulkPdfReports.dto.js';
import Joi from 'joi';

const router = express.Router();

const singleSchema = Joi.object({ reportId: Joi.string().required() });

// Aplicar autenticación a todas las rutas
router.use(authenticate);

router.post('/bulk', authorize(PERMISSIONS.PDF_REPORTS_GENERATE), validate(bulkPdfReportsDto, 'body'), generateBulkPDFs); // Generate multiple PDFs and return as ZIP
router.post('/single', authorize(PERMISSIONS.PDF_REPORTS_GENERATE), validate(singleSchema, 'body'), generateSinglePDF);  // genera un solo PDF
// Health check: any authenticated user can probe the PDF microservice status.
router.get('/health', checkMicroserviceHealth);

export default router;
