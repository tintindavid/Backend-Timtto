'use strict';
import Joi from 'joi';
import { NOTIFICATION_EVENTS } from '../config/notificationEvents.js';
import { NOTIFICATION_CHANNELS } from '../models/notification.model.js';

const objectId = Joi.string().hex().length(24);
const NOTIFICATION_RULE_ROLES = ['admin', 'technician', 'user', 'superadmin'];

const recipientsDto = Joi.object({
  roles: Joi.array().items(Joi.string().valid(...NOTIFICATION_RULE_ROLES)).default([]),
  userIds: Joi.array().items(objectId).default([]),
});

/** POST /api/v1/notification-rules — `event` is immutable, not present in updateNotificationRuleDto. */
export const createNotificationRuleDto = Joi.object({
  event: Joi.string().valid(...NOTIFICATION_EVENTS).required(),
  recipients: recipientsDto.default({ roles: [], userIds: [] }),
  channels: Joi.array().items(Joi.string().valid(...NOTIFICATION_CHANNELS)).min(1).default(['inapp']),
  enabled: Joi.boolean().default(true),
}).unknown(false);

/** PUT /api/v1/notification-rules/:id */
export const updateNotificationRuleDto = Joi.object({
  recipients: recipientsDto.optional(),
  channels: Joi.array().items(Joi.string().valid(...NOTIFICATION_CHANNELS)).min(1).optional(),
  enabled: Joi.boolean().optional(),
}).unknown(false);
