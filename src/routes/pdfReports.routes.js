'use strict';
import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { generateBulkPDFs, generateSinglePDF, checkMicroserviceHealth } from '../controllers/pdfReports.controller.js';
import Joi from 'joi';

const router = express.Router();

const bulkSchema = Joi.object({
  reportIds: Joi.array().items(Joi.string().trim()).optional(),
  filters: Joi.object().optional(),
  otId: Joi.string().optional(),
  sheetworkId: Joi.string().optional(),
});

const singleSchema = Joi.object({ reportId: Joi.string().required() });

// Aplicar autenticación a todas las rutas
router.use(authenticate);

router.post('/bulk', validate(bulkSchema, 'body'), generateBulkPDFs); // Generate multiple PDFs and return as ZIP
router.post('/single', validate(singleSchema, 'body'), generateSinglePDF);  // genera un solo PDF
router.get('/health', checkMicroserviceHealth);  // revisa el estado del microservicio de PDF 

export default router;
