 'use strict';
import axios from 'axios';
import { logger } from '../config/logger.config.js';
import { ApiError } from '../utils/apiError.util.js';
import { env } from '../config/env.js';

export default class PDFMicroserviceClient {
  constructor(config = {}) {
    const provided = (config.url || env.PDF_SERVICE_URL || 'http://localhost:3000');
    const timeout = Number(env.PDF_MICROSERVICE_TIMEOUT || 30000);
    // Normalize: if provided already contains /api/pdf, keep it; otherwise append
    const normalizedBase = provided.replace(/\/$/, '');
    const endpoint = normalizedBase.match(/\/api\/pdf(\/)?$/i) ? normalizedBase : `${normalizedBase}/api/pdf`;
    // Health URL should point to base/health (without /api/pdf)
    const healthBase = normalizedBase.replace(/\/api\/pdf(\/)?$/i, '') || normalizedBase;
    logger.info('PDFMicroserviceClient configured with endpoint:', { endpoint, healthUrl: `${healthBase}/health`, timeout });
    this.config = { url: normalizedBase, endpoint, healthUrl: `${healthBase}/health`, timeout, ...config };
  }

  async generatePDF(html, options = {}) {
    try {
      logger.debug(`PDF Microservice endpoint: ${this.config.endpoint}`);
      const defaultOptions = {
        format: 'A4',
        landscape: false,
        printBackground: true,
        margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' },
      };
      const body = { html, options: { ...defaultOptions, ...options } };

      logger.debug('Sending request to PDF microservice...');
      logger.debug(JSON.stringify(body).substring(0, 500)); // log first 500 chars only
      const response = await axios.post(this.config.endpoint, body, {
        headers: { 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: this.config.timeout,
      });
      return Buffer.from(response.data);
    } catch (err) {
      throw this.handleError(err);
    }
  }

  async healthCheck() {
    try {
      logger.info('Checking PDF microservice health at', { url: this.config.healthUrl });
      const res = await axios.get(this.config.healthUrl, { timeout: this.config.timeout });
      return res.status === 200;
    } catch (err) {
      logger.warn('PDFMicroserviceClient.healthCheck failed', { err: err.message });
      return false;
    }
  }

  handleError(error) {
    if (error.response) {
      const { status, statusText } = error.response;
      return new ApiError(502, `Microservicio PDF: ${status} - ${statusText}`, 'PDF_MICROSERVICE_ERROR');
    }
    if (error.request) {
      return new ApiError(504, 'Microservicio PDF no responde', 'PDF_MICROSERVICE_TIMEOUT');
    }
    return new ApiError(500, `Error al generar PDF: ${error.message}`, 'PDF_MICROSERVICE_CLIENT_ERROR');
  }
}
