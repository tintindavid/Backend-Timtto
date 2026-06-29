'use strict';
import { serviceQrService } from '../services/serviceQr.service.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';
import path from 'path';
import fs from 'fs';

export class ServiceQrController {
  async create(req, res, next) {
    try {
      const data = await serviceQrService.create(req.body, req.tenantId, req.user?.userId);
      res.status(201).json(successResponse(data, 'QR creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, sortBy, order, search, ...filters } = req.query;
      const result = await serviceQrService.list(
        filters,
        { page, limit, sortBy, order, search },
        req.tenantId
      );
      res.json(successResponse(result.data, 'QRs recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await serviceQrService.findById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'QR recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async rotatePassword(req, res, next) {
    try {
      const data = await serviceQrService.rotatePassword(req.params.id, req.body.newPassword, req.tenantId);
      res.json(successResponse(data, 'Password rotada exitosamente'));
    } catch (err) { next(err); }
  }

  async deactivate(req, res, next) {
    try {
      const data = await serviceQrService.deactivate(req.params.id, req.tenantId);
      res.json(successResponse(data, 'QR desactivado exitosamente'));
    } catch (err) { next(err); }
  }

  async activate(req, res, next) {
    try {
      const data = await serviceQrService.activate(req.params.id, req.tenantId);
      res.json(successResponse(data, 'QR activado exitosamente'));
    } catch (err) { next(err); }
  }

  async softDelete(req, res, next) {
    try {
      await serviceQrService.softDelete(req.params.id, req.tenantId);
      res.json(successResponse(null, 'QR eliminado exitosamente'));
    } catch (err) { next(err); }
  }

  /**
   * GET /api/service-qrs/:id/qr-image
   * Streams the persisted PNG. Tenant scope enforced in the service layer.
   */
  async getQrImage(req, res, next) {
    try {
      const filePath = await serviceQrService.getQrImagePath(req.params.id, req.tenantId);
      if (!filePath || !fs.existsSync(filePath)) {
        return next(new ApiError(404, 'QR image not found', 'QR_IMAGE_NOT_FOUND', { id: req.params.id }));
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      fs.createReadStream(filePath).pipe(res);
    } catch (err) { next(err); }
  }
}

export const serviceQrController = new ServiceQrController();
