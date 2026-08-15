'use strict';
import mongoose from 'mongoose';
import { NotificationRule } from '../models/notificationRule.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { logger } from '../config/logger.config.js';

/**
 * Rejects any `recipients.userIds` that do not belong to `tenantId` (or are
 * soft-deleted). Prevents an admin from injecting a foreign-tenant userId
 * into a rule — which the bus would otherwise persist a Notification for
 * and push over the `user:{userId}` socket room, leaking title/body/data
 * across tenants (adversarial Blocker, design.md D3 invariant).
 */
async function assertUserIdsBelongToTenant(userIds, tenantId) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  const validIds = userIds.filter((id) => mongoose.isValidObjectId(id));
  if (validIds.length === 0) return;
  const existing = await User.find(
    { _id: { $in: validIds }, tenantId, isDeleted: false },
    '_id'
  ).lean();
  const existingSet = new Set(existing.map((u) => String(u._id)));
  const foreign = validIds.filter((id) => !existingSet.has(String(id)));
  if (foreign.length > 0) {
    throw new ApiError(
      400,
      'Uno o más userIds no pertenecen al tenant o están eliminados',
      'INVALID_RECIPIENT_USER_IDS',
      { foreignUserIds: foreign }
    );
  }
}

/**
 * NotificationRuleService — admin-only CRUD over per-tenant, per-event
 * notification configuration (design.md D6, requirement "Per-tenant
 * NotificationRule configuration"). `event` is immutable after creation —
 * it is the other half of the rule's identity, so `update()` never touches it.
 */
export class NotificationRuleService {
  async list(tenantId) {
    requireTenant(tenantId);
    return NotificationRule.find(applyTenantFilter({}, tenantId)).sort({ event: 1 }).lean();
  }

  async getById(id, tenantId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Regla no encontrada', 'NOT_FOUND', { id });
    }
    const rule = await NotificationRule.findOne(applyTenantFilter({ _id: id }, tenantId)).lean();
    if (!rule) throw new ApiError(404, 'Regla no encontrada', 'NOT_FOUND', { id });
    return rule;
  }

  async create(data, tenantId) {
    requireTenant(tenantId);
    await assertUserIdsBelongToTenant(data?.recipients?.userIds, tenantId);
    const exists = await NotificationRule.exists({ tenantId, event: data.event });
    if (exists) {
      throw new ApiError(
        409,
        `Ya existe una regla configurada para el evento "${data.event}"`,
        'RULE_ALREADY_EXISTS',
        { event: data.event }
      );
    }
    try {
      const rule = await NotificationRule.create({ ...data, tenantId });
      logger.info('NotificationRule created', { tenantId, event: data.event });
      return rule.toJSON();
    } catch (err) {
      if (err && err.code === 11000) {
        throw new ApiError(
          409,
          `Ya existe una regla configurada para el evento "${data.event}"`,
          'RULE_ALREADY_EXISTS',
          { event: data.event }
        );
      }
      throw err;
    }
  }

  async update(id, data, tenantId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Regla no encontrada', 'NOT_FOUND', { id });
    }
    const rule = await NotificationRule.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!rule) throw new ApiError(404, 'Regla no encontrada', 'NOT_FOUND', { id });

    if (data.recipients !== undefined) {
      await assertUserIdsBelongToTenant(data.recipients.userIds, tenantId);
      rule.recipients = data.recipients;
    }
    if (data.channels !== undefined) rule.channels = data.channels;
    if (data.enabled !== undefined) rule.enabled = data.enabled;

    await rule.save();
    logger.info('NotificationRule updated', { tenantId, id });
    return rule.toJSON();
  }

  async remove(id, tenantId) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'Regla no encontrada', 'NOT_FOUND', { id });
    }
    const rule = await NotificationRule.findOne(applyTenantFilter({ _id: id }, tenantId));
    if (!rule) throw new ApiError(404, 'Regla no encontrada', 'NOT_FOUND', { id });

    rule.isDeleted = true;
    rule.deletedAt = new Date();
    await rule.save();
    logger.info('NotificationRule soft-deleted', { tenantId, id });
  }
}

export const notificationRuleService = new NotificationRuleService();
