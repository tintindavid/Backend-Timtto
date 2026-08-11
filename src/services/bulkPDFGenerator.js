'use strict';
import JSZip from 'jszip';
import PDFMicroserviceClient from './pdfMicroserviceClient.js';
import { logger } from '../config/logger.config.js';
import { ApiError } from '../utils/apiError.util.js';
import { buildBulkPdfFilename } from '../utils/filenameSanitize.util.js';

export default class BulkPDFGenerator {
  constructor(pdfClient = null) {
    this.pdfClient = pdfClient || new PDFMicroserviceClient();
  }

  async generateBulkPDFs(reports = [], htmlGenerator, options = {}) {
    this.fileNameConfig = options.fileNameConfig || null;
    const zip = new JSZip();
    const results = { successful: 0, failed: 0, errors: [] };
    const total = reports.length;
    logger.info(`Iniciando generación de ${total} PDFs...`);

    const healthy = await this.pdfClient.healthCheck();
    if (!healthy) throw new ApiError(503, 'Microservicio PDF no disponible', 'PDF_MICROSERVICE_OFFLINE');

    for (let i = 0; i < total; i += 1) {
      const report = reports[i];
      const numeroReporte = report.consecutivo || String(report._id);
      logger.info(`Procesando ${i + 1}/${total} - Reporte: ${numeroReporte}`);
      try {
        const html = await htmlGenerator(report);
        const pdfBuffer = await this.pdfClient.generatePDF(html);
        const fileName = this.generateFileName(report, i);
        zip.file(fileName, pdfBuffer);
        results.successful += 1;
        logger.info(`✅ PDF generado: ${fileName}`);
      } catch (err) {
        results.failed += 1;
        const message = err?.message || 'Error desconocido';
        results.errors.push({ reportId: report._id, numeroReporte, error: message });
        logger.error(`❌ Error generando PDF para ${numeroReporte}: ${message}`);
        try {
          zip.file(`ERROR_${numeroReporte}.txt`, message);
        } catch (e) {
          logger.warn('No se pudo agregar archivo de error al ZIP', { e: e.message });
        }
      }
    }

    logger.info('📦 Generando archivo ZIP...');
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    this.printSummary(results, zipBuffer.length);
    return zipBuffer;
  }

  generateFileName(report, index = 0) {
    // Config-driven path (pdf-reports-filename-builder): if the caller passed
    // a valid `fileNameConfig.tokens`, use the shared sanitizer. Missing or
    // empty config falls back to the legacy pattern below for backward
    // compatibility with every existing caller (e.g. clientPortal's
    // getSheetReportsZip which invokes the generator directly without opts).
    const tokens = this.fileNameConfig?.tokens;
    if (Array.isArray(tokens) && tokens.length > 0) {
      const configured = buildBulkPdfFilename(report, tokens);
      if (configured) return configured;
    }
    const numeroReporte = (report.consecutivo || report._id || `report_${index}`).toString();
    const safe = numeroReporte.replace(/[^a-zA-Z0-9-_.]/g, '_');
    const item = (report.equipoSnapshot?.ItemText?.toUpperCase() || 'SN').replace(/[^a-zA-Z0-9-_.]/g, '_');
    const inventario = report.equipoSnapshot?.Inventario || 'SN';
    return `${safe} ${item} ${inventario}.pdf`;
  }

  printSummary(results, zipSize) {
    const mb = (zipSize / (1024 * 1024)).toFixed(2);
    logger.info('═══════════════════════════════════════════');
    logger.info('          RESUMEN DE GENERACIÓN');
    logger.info('═══════════════════════════════════════════');
    logger.info(`✅ Exitosos:        ${results.successful}`);
    logger.info(`❌ Fallidos:        ${results.failed}`);
    logger.info(`📦 Tamaño del ZIP:  ${mb} MB`);
    if (results.errors.length) {
      logger.info('⚠️  Errores encontrados:');
      results.errors.forEach((e, idx) => logger.info(`${idx + 1}. ${e.numeroReporte}: ${e.error}`));
    }
    logger.info('═══════════════════════════════════════════');
  }
}
