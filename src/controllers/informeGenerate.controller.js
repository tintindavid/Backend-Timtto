'use strict';
import { informeGenerateService } from '../services/informeGenerate.service.js';
import { buildInformeHtml } from '../services/informeHtml.service.js';
import PDFMicroserviceClient from '../services/pdfMicroserviceClient.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';

const pdfClient = new PDFMicroserviceClient();

function sanitizeFilename(str) {
  return String(str || 'informe')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-\.]/g, '')
    .slice(0, 80);
}

export class InformeGenerateController {
  /**
   * POST /api/v1/informes/generate
   * Returns the aggregated JSON payload for the report.
   */
  async generateData(req, res, next) {
    try {
      const { clienteId, mesDesde, mesHasta } = req.body;
      const tenantId = req.tenantId;

      if (!tenantId) {
        throw new ApiError(400, 'Falta el header x-tenant-id', 'MISSING_TENANT_HEADER');
      }

      const payload = await informeGenerateService.generate(
        clienteId,
        mesDesde,
        mesHasta,
        tenantId,
        req.user || {},
      );

      res.json(successResponse(payload, 'Informe generado exitosamente'));
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/informes/generate/pdf
   * Streams the generated PDF as a binary attachment.
   */
  async generatePdf(req, res, next) {
    try {
      const { clienteId, mesDesde, mesHasta, observacionGeneral } = req.body;
      const tenantId = req.tenantId;

      if (!tenantId) {
        throw new ApiError(400, 'Falta el header x-tenant-id', 'MISSING_TENANT_HEADER');
      }

      const payload = await informeGenerateService.generate(
        clienteId,
        mesDesde,
        mesHasta,
        tenantId,
        req.user || {},
        {},
        observacionGeneral ?? '',
      );

      const html = buildInformeHtml(payload);

      const pdfBuffer = await pdfClient.generatePDF(html, {
        format: 'A4',
        landscape: false,
        printBackground: true,
        margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
      });

      const clienteNombre = sanitizeFilename(payload.meta.clienteNombre);
      const periodo       = sanitizeFilename(payload.meta.periodoLabel);
      const filename      = `Informe_${clienteNombre}_${periodo}_${Date.now()}.pdf`;

      logger.info('Informe PDF generado', {
        tenantId, clienteId, mesDesde, mesHasta, filename, size: pdfBuffer.length,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  }
}

export const informeGenerateController = new InformeGenerateController();
