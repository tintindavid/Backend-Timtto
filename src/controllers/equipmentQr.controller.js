'use strict';
import fs from 'fs';
import { equipmentQrService } from '../services/equipmentQr.service.js';
import { equipmentQrPdfService } from '../services/equipmentQrPdf.service.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';
import { getQrPngAbsolutePath, generateQrPng, uploadQrPng } from '../utils/qrImage.util.js';
import { env } from '../config/env.js';
import { MAX_BULK_PDF } from '../constants/equipmentQr.constants.js';

export class EquipmentQrController {
  /** POST /api/v1/equipment-qrs — idempotent create (design D3). */
  async create(req, res, next) {
    try {
      const { equipoId } = req.body;
      const { created, doc } = await equipmentQrService.generateForEquipo(equipoId, req.tenantId, req.user?.userId);
      const status = created ? 201 : 200;
      res.status(status).json(successResponse(doc, created ? 'QR de equipo creado exitosamente' : 'QR de equipo ya existía', status));
    } catch (err) { next(err); }
  }

  /** POST /api/v1/equipment-qrs/bulk-generate */
  async bulkGenerate(req, res, next) {
    try {
      const { filter = {} } = req.body;
      const result = await equipmentQrService.generateBulk(filter, req.tenantId, req.user?.userId);
      res.json(successResponse(result, 'Generación masiva de QRs completada'));
    } catch (err) { next(err); }
  }

  /** GET /api/v1/equipment-qrs */
  async list(req, res, next) {
    try {
      const { page, limit, ...filters } = req.query;
      const result = await equipmentQrService.list(filters, { page, limit }, req.tenantId);
      res.json(successResponse(result.data, 'QRs de equipo recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  /** GET /api/v1/equipment-qrs/:id */
  async getById(req, res, next) {
    try {
      const data = await equipmentQrService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'QR de equipo recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  /** POST /api/v1/equipment-qrs/:id/deactivate */
  async deactivate(req, res, next) {
    try {
      const data = await equipmentQrService.deactivate(req.params.id, req.tenantId);
      res.json(successResponse(data, 'QR de equipo desactivado exitosamente'));
    } catch (err) { next(err); }
  }

  /** DELETE /api/v1/equipment-qrs/:id */
  async softDelete(req, res, next) {
    try {
      await equipmentQrService.softDelete(req.params.id, req.tenantId);
      res.json(successResponse({ ok: true }, 'QR de equipo eliminado exitosamente'));
    } catch (err) { next(err); }
  }

  /**
   * GET /api/v1/equipment-qrs/:id/qr-image
   * Streams the persisted PNG (auth-protected), same convention as
   * serviceQr.controller.js#getQrImage. When the on-disk file is missing
   * (Railway wipes `uploads/qr` on every redeploy and horizontal scaling
   * hides per-instance writes), the PNG is regenerated on the fly from
   * the deterministic landing URL — same bytes, no stale 404.
   */
  async getQrImage(req, res, next) {
    try {
      // Resolve + tenant-check the QR doc first so we can regenerate from
      // its `qrToken` if the on-disk file is gone.
      const qr = await equipmentQrService.getById(req.params.id, req.tenantId);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');

      const filePath = getQrPngAbsolutePath(req.params.id, 'equipment-qrs');
      if (fs.existsSync(filePath)) {
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      if (!qr.qrToken) {
        return next(new ApiError(404, 'QR image not found', 'QR_IMAGE_NOT_FOUND', { id: req.params.id }));
      }
      const landingUrl = `${env.PUBLIC_APP_BASE_URL.replace(/\/+$/, '')}/public/equipo/${qr.qrToken}`;
      const buffer = await generateQrPng(landingUrl);
      // Speculative warm-up — ignore write failures (read-only fs etc.).
      uploadQrPng(buffer, null, { id: req.params.id, scope: 'equipment-qrs' }).catch(() => {});
      res.send(buffer);
    } catch (err) { next(err); }
  }

  /** GET /api/v1/equipment-qrs/export-pdf/:id — single A6 sticker PDF. */
  async exportPdfSingle(req, res, next) {
    try {
      const buffer = await equipmentQrPdfService.generateSingle(req.params.id, req.tenantId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="equipment-qr-${req.params.id}.pdf"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) { next(err); }
  }

  /**
   * GET /api/v1/equipment-qrs/export-pdf?ids=…|&filter=<json>
   * Bulk A4-landscape PDF, capped at MAX_BULK_PDF (design D12).
   */
  async exportPdfBulk(req, res, next) {
    try {
      const tenantId = req.tenantId;
      let ids = [];
      if (req.query.ids) {
        ids = String(req.query.ids).split(',').map((s) => s.trim()).filter(Boolean);
      } else if (req.query.filter) {
        let parsedFilter = {};
        try { parsedFilter = JSON.parse(req.query.filter); } catch { parsedFilter = {}; }
        ids = await equipmentQrService.resolveIdsForExport(parsedFilter, tenantId);
      } else {
        return next(new ApiError(400, 'Debes proporcionar ids o filter', 'INVALID_PARAMS'));
      }

      if (ids.length > MAX_BULK_PDF) {
        return next(new ApiError(
          400,
          `El PDF admite máximo ${MAX_BULK_PDF} stickers; filtra la selección`,
          'BULK_PDF_LIMIT_EXCEEDED',
          { count: ids.length, max: MAX_BULK_PDF }
        ));
      }

      const buffer = await equipmentQrPdfService.generateBulk(ids, tenantId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="equipment-qrs.pdf"');
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) { next(err); }
  }
}

export const equipmentQrController = new EquipmentQrController();
