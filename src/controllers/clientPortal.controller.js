'use strict';
import { clientPortalService } from '../services/clientPortal.service.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { env } from '../config/env.js';

export class ClientPortalController {
  async getConsolidated(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store, private');
      const data = await clientPortalService.getConsolidatedView(req.tenantId, req.clienteId, req.otIds);
      res.status(200).json(successResponse(data, 'Vista consolidada del portal cliente'));
    } catch (err) { next(err); }
  }

  async getReportDetail(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store, private');
      const data = await clientPortalService.getReportDetail(req.tenantId, req.otIds, req.params.reportId);
      res.status(200).json(successResponse(data, 'Detalle de reporte'));
    } catch (err) { next(err); }
  }

  /**
   * Renders the report as an HTML document identical to the final PDF the
   * client will receive at handover. Client-portal `ReportDetailModal` loads
   * this as an `<iframe src="...">`, which in dev is cross-origin
   * (frontend :5173 vs backend :3000). helmet()'s default CSP includes
   * `frame-ancestors 'self'` which blocks that iframe — so this endpoint
   * overrides CSP with the same allow-list CORS uses (`env.CORS_ORIGINS`)
   * and REMOVES `X-Frame-Options` (which only supports 'SAMEORIGIN'/'DENY',
   * no allow-list). Modern browsers honor `frame-ancestors` when both are
   * present, but stripping XFO avoids ambiguity in older engines.
   *
   * `Cache-Control: no-store, private` keeps the sensitive PII off any
   * CDN cache.
   */
  async getReportPdfView(req, res, next) {
    try {
      const html = await clientPortalService.getReportPdfViewHtml(
        req.tenantId,
        req.otIds,
        req.params.reportId,
        req.tokenId
      );
      const allowedFrameAncestors = ["'self'", ...env.CORS_ORIGINS].join(' ');
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'no-store, private');
      res.set('Content-Security-Policy', `frame-ancestors ${allowedFrameAncestors}`);
      res.removeHeader('X-Frame-Options');
      res.status(200).send(html);
    } catch (err) { next(err); }
  }

  async markReviewed(req, res, next) {
    try {
      const data = await clientPortalService.markReviewed(
        req.tenantId,
        req.otIds,
        req.params.reportId,
        req.tokenId
      );
      res.status(200).json(successResponse(data, 'Reporte marcado como revisado'));
    } catch (err) { next(err); }
  }

  async unmarkReviewed(req, res, next) {
    try {
      await clientPortalService.unmarkReviewed(req.tenantId, req.otIds, req.params.reportId);
      res.status(204).end();
    } catch (err) { next(err); }
  }

  async updateClientNote(req, res, next) {
    try {
      const data = await clientPortalService.updateClientNote(
        req.tenantId,
        req.otIds,
        req.params.reportId,
        req.tokenId,
        req.body?.text
      );
      res.status(200).json(successResponse(data, 'Nota del cliente actualizada'));
    } catch (err) { next(err); }
  }

  async sign(req, res, next) {
    try {
      const meta = { ip: req.ip, userAgent: req.headers?.['user-agent'] };
      const data = await clientPortalService.signAndCreateSheets(
        req.tenantId,
        req.tokenId,
        req.otIds,
        req.body,
        meta
      );
      res.status(202).json(successResponse(data, 'Firma registrada, generando documentos'));
    } catch (err) { next(err); }
  }

  /**
   * Returns HTML preview of the N HTs that would be created for the same
   * body if it were submitted to `/sign`. Reuses the CSP/embed override
   * from `getReportPdfView` so the client SPA can iframe it cross-origin
   * in dev without violating the `frame-ancestors` policy.
   */
  async signPreview(req, res, next) {
    try {
      const html = await clientPortalService.previewSignAsHtml(
        req.tenantId,
        req.tokenId,
        req.otIds,
        req.body
      );
      const allowedFrameAncestors = ["'self'", ...env.CORS_ORIGINS].join(' ');
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'no-store, private');
      res.set('Content-Security-Policy', `frame-ancestors ${allowedFrameAncestors}`);
      res.removeHeader('X-Frame-Options');
      res.status(200).send(html);
    } catch (err) { next(err); }
  }

  async getSheets(req, res, next) {
    try {
      const data = await clientPortalService.getSheetsForToken(req.tenantId, req.tokenId);
      res.status(200).json(successResponse(data, 'Hojas de trabajo del token'));
    } catch (err) { next(err); }
  }

  async getSheetPdf(req, res, next) {
    try {
      const { url } = await clientPortalService.getSheetPdfLocation(
        req.tenantId,
        req.tokenId,
        req.params.sheetId
      );
      res.redirect(302, url);
    } catch (err) { next(err); }
  }
}

export const clientPortalController = new ClientPortalController();
