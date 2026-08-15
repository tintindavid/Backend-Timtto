'use strict';
import Joi from 'joi';
import { NOTIFICATION_EVENTS } from '../config/notificationEvents.js';
import { NOTIFICATION_CHANNELS } from '../models/notification.model.js';

/** PUT /api/v1/notification-preferences — upsert by (tenantId, userId, event). */
export const upsertNotificationPreferenceDto = Joi.object({
  event: Joi.string().valid(...NOTIFICATION_EVENTS).required(),
  mutedChannels: Joi.array().items(Joi.string().valid(...NOTIFICATION_CHANNELS)).default([]),
}).unknown(false);
