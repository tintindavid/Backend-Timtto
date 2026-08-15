'use strict';
import { notificationRuleService } from '../services/notificationRule.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class NotificationRuleController {
  async list(req, res, next) {
    try {
      const data = await notificationRuleService.list(req.tenantId);
      res.json(successResponse(data, 'Reglas de notificación recuperadas exitosamente'));
    } catch (err) { next(err); }
  }

  async getById(req, res, next) {
    try {
      const data = await notificationRuleService.getById(req.params.id, req.tenantId);
      res.json(successResponse(data, 'Regla de notificación recuperada exitosamente'));
    } catch (err) { next(err); }
  }

  async create(req, res, next) {
    try {
      const data = await notificationRuleService.create(req.body, req.tenantId);
      res.status(201).json(successResponse(data, 'Regla de notificación creada exitosamente', 201));
    } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try {
      const data = await notificationRuleService.update(req.params.id, req.body, req.tenantId);
      res.json(successResponse(data, 'Regla de notificación actualizada exitosamente'));
    } catch (err) { next(err); }
  }

  async remove(req, res, next) {
    try {
      await notificationRuleService.remove(req.params.id, req.tenantId);
      res.status(204).send();
    } catch (err) { next(err); }
  }
}

export const notificationRuleController = new NotificationRuleController();
