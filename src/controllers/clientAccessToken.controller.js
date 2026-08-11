'use strict';
import { clientAccessTokenService } from '../services/clientAccessToken.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class ClientAccessTokenController {
  async create(req, res, next) {
    try {
      const data = await clientAccessTokenService.create(req.body, req.tenantId, req.user?.userId);
      res.status(201).json(successResponse(data, 'Acceso cliente creado exitosamente', 201));
    } catch (err) { next(err); }
  }

  async list(req, res, next) {
    try {
      const { page, limit, ...filters } = req.query;
      const result = await clientAccessTokenService.listByTenant(filters, { page, limit }, req.tenantId);
      res.json(successResponse(result.data, 'Accesos cliente recuperados exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await clientAccessTokenService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Acceso cliente recuperado exitosamente'));
    } catch (err) { next(err); }
  }

  async revoke(req, res, next) {
    try {
      const data = await clientAccessTokenService.revoke(req.params.id, req.tenantId, req.user?.userId);
      res.json(successResponse(data, 'Acceso cliente revocado exitosamente'));
    } catch (err) { next(err); }
  }

  async softDelete(req, res, next) {
    try {
      await clientAccessTokenService.softDelete(req.params.id, req.tenantId);
      res.status(204).send();
    } catch (err) { next(err); }
  }

  /** PATCH /:id/ots */
  async addOts(req, res, next) {
    try {
      const data = await clientAccessTokenService.addOts(req.params.id, req.body.otIds, req.tenantId);
      res.json(successResponse(data, 'OTs añadidas al acceso'));
    } catch (err) { next(err); }
  }

  /** POST /:id/send */
  async sendLink(req, res, next) {
    try {
      const data = await clientAccessTokenService.sendLink(
        req.params.id,
        req.body.email,
        req.tenantId,
        req.user?.userId
      );
      res.json(successResponse(data, 'Solicitud de envío procesada'));
    } catch (err) { next(err); }
  }
}

export const clientAccessTokenController = new ClientAccessTokenController();
