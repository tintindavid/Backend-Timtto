'use strict';
import { Router } from 'express';
import { notificationRuleController } from '../controllers/notificationRule.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/requireRole.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createNotificationRuleDto, updateNotificationRuleDto } from '../dtos/notificationRule.dto.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin'));

router.get('/', notificationRuleController.list);
router.get('/:id', notificationRuleController.getById);
router.post('/', validate(createNotificationRuleDto, 'body'), notificationRuleController.create);
router.put('/:id', validate(updateNotificationRuleDto, 'body'), notificationRuleController.update);
router.delete('/:id', notificationRuleController.remove);

export default router;
