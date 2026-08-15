'use strict';
import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/requireRole.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { queryNotificationsDto } from '../dtos/notification.dto.js';

const router = Router();
router.use(authenticate);

router.get('/events', notificationController.events);
router.get('/unread-count', notificationController.unreadCount);
router.get('/', validate(queryNotificationsDto, 'query'), notificationController.list);
router.post('/read-all', notificationController.markAllAsRead);
router.post('/test', requireRole('admin'), notificationController.test);
router.post('/:id/read', notificationController.markAsRead);

export default router;
