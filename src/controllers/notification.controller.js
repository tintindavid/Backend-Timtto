'use strict';
import { notificationService } from '../services/notification.service.js';
import { NotificationRule } from '../models/notificationRule.model.js';
import { NOTIFICATION_EVENTS } from '../config/notificationEvents.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { ApiError } from '../utils/apiError.util.js';

// In-memory rate limit for POST /notifications/test — 1 call per admin per
// minute (requirement "Admin-triggered test event"). Single dyno, same
// convention as notification.service.js's tenant rate limit.
const TEST_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const lastTestByAdmin = new Map();

export class NotificationController {
  async list(req, res, next) {
    try {
      const { page, limit, unread } = req.query;
      const result = await notificationService.list({
        tenantId: req.tenantId,
        userId: req.user.userId,
        page,
        limit,
        unread,
      });
      res.json(successResponse(result.data, 'Notificaciones recuperadas exitosamente', 200, result.pagination));
    } catch (err) { next(err); }
  }

  async unreadCount(req, res, next) {
    try {
      const data = await notificationService.unreadCount({ tenantId: req.tenantId, userId: req.user.userId });
      res.json(successResponse(data, 'Conteo de notificaciones no leídas'));
    } catch (err) { next(err); }
  }

  async markAsRead(req, res, next) {
    try {
      const data = await notificationService.markAsRead({
        tenantId: req.tenantId,
        userId: req.user.userId,
        notificationId: req.params.id,
      });
      res.json(successResponse(data, 'Notificación marcada como leída'));
    } catch (err) { next(err); }
  }

  async markAllAsRead(req, res, next) {
    try {
      const data = await notificationService.markAllAsRead({ tenantId: req.tenantId, userId: req.user.userId });
      res.json(successResponse(data, 'Notificaciones marcadas como leídas'));
    } catch (err) { next(err); }
  }

  async events(_req, res, next) {
    try {
      res.json(successResponse(NOTIFICATION_EVENTS, 'Eventos de notificación disponibles'));
    } catch (err) { next(err); }
  }

  /** POST /notifications/test — requireRole('admin') at the route layer. */
  async test(req, res, next) {
    try {
      const adminId = req.user.userId;
      const now = Date.now();
      const lastAt = lastTestByAdmin.get(adminId);
      if (lastAt && now - lastAt < TEST_RATE_LIMIT_WINDOW_MS) {
        throw new ApiError(429, 'Ya enviaste una notificación de prueba. Espera un minuto antes de reintentar.', 'RATE_LIMITED');
      }

      const rule = await NotificationRule.findOne({ tenantId: req.tenantId, event: 'system.test' }).lean();
      if (!rule) {
        throw new ApiError(
          409,
          'Configura primero la regla de notificación para el evento "system.test".',
          'no_rule_configured'
        );
      }

      lastTestByAdmin.set(adminId, now);
      await notificationService.emit(req.tenantId, 'system.test', { triggeredBy: adminId });
      res.status(202).json(successResponse(null, 'Notificación de prueba enviada', 202));
    } catch (err) { next(err); }
  }
}

export const notificationController = new NotificationController();
