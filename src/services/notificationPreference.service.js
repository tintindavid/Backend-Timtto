'use strict';
import { NotificationPreference } from '../models/notificationPreference.model.js';
import { requireTenant } from '../utils/tenant.util.js';

/**
 * NotificationPreferenceService — always scoped to the caller (tenantId +
 * userId from req.tenant/req.user, never a route param). Cross-user access
 * is structurally impossible: there is no `:userId` in the route, so
 * "Users MUST only be able to read and modify their own preferences" holds
 * by construction, not by an ownership check.
 */
export class NotificationPreferenceService {
  async listMine(tenantId, userId) {
    requireTenant(tenantId);
    return NotificationPreference.find({ tenantId, userId }).lean();
  }

  /** Upsert by (tenantId, userId, event) — design.md D6/requirement scenario. */
  async upsert(tenantId, userId, { event, mutedChannels }) {
    requireTenant(tenantId);
    return NotificationPreference.findOneAndUpdate(
      { tenantId, userId, event },
      { $set: { mutedChannels: mutedChannels || [] } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  }
}

export const notificationPreferenceService = new NotificationPreferenceService();
