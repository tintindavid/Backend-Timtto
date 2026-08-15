'use strict';
import { Router } from 'express';
import { notificationPreferenceController } from '../controllers/notificationPreference.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { upsertNotificationPreferenceDto } from '../dtos/notificationPreference.dto.js';

const router = Router();
router.use(authenticate);

router.get('/', notificationPreferenceController.list);
router.put('/', validate(upsertNotificationPreferenceDto, 'body'), notificationPreferenceController.upsert);

export default router;
