'use strict';
import { notificationPreferenceService } from '../services/notificationPreference.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class NotificationPreferenceController {
  async list(req, res, next) {
    try {
      const data = await notificationPreferenceService.listMine(req.tenantId, req.user.userId);
      res.json(successResponse(data, 'Preferencias de notificación recuperadas exitosamente'));
    } catch (err) { next(err); }
  }

  async upsert(req, res, next) {
    try {
      const data = await notificationPreferenceService.upsert(req.tenantId, req.user.userId, req.body);
      res.json(successResponse(data, 'Preferencia de notificación actualizada exitosamente'));
    } catch (err) { next(err); }
  }
}

export const notificationPreferenceController = new NotificationPreferenceController();
