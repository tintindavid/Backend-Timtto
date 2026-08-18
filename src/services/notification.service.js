'use strict';
import mongoose from 'mongoose';
import { Notification } from '../models/notification.model.js';
import { NotificationRule } from '../models/notificationRule.model.js';
import { NotificationPreference } from '../models/notificationPreference.model.js';
import { User } from '../models/user.model.js';
import { socketBridge } from '../socket/index.js';
import { ApiError } from '../utils/apiError.util.js';
import { requireTenant } from '../utils/tenant.util.js';
import { logger } from '../config/logger.config.js';

// In-process rate limit (design.md D10): max 100 emits/minute per tenant.
// Single Railway dyno today, so in-memory is sufficient — would move to
// Redis alongside the socket adapter if we ever scale horizontally.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_EMITS = 100;
const rateLimitByTenant = new Map();

function isRateLimited(tenantId) {
  const now = Date.now();
  const entry = rateLimitByTenant.get(tenantId);
  if (!entry || now >= entry.resetAt) {
    rateLimitByTenant.set(tenantId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX_EMITS) return true;
  entry.count += 1;
  return false;
}

export class NotificationService {
  // =====================================================================
  // CENTRAL BUS (design.md D7) — the ONLY public entry point future
  // features use to notify anyone. Never throws for a single-recipient
  // failure; the fanout always completes for the remaining recipients.
  // =====================================================================

  /**
   * @param {string} tenantId
   * @param {string} event - one of NOTIFICATION_EVENTS (config/notificationEvents.js)
   * @param {object} [payload] - `{ title?, body?, data?, ...rest }`. `title`/`body`
   *   default to the event name / empty string when omitted. Everything else
   *   (or an explicit `data` key) is stored verbatim in `Notification.data` —
   *   IDs only, per design.md Risks ("payloads contienen IDs, no datos sensibles crudos").
   * @param {object} [options]
   * @param {string[]} [options.extraRecipientUserIds] - additional recipients,
   *   unioned with the rule's resolved set.
   * @param {string[]} [options.excludeRecipientUserIds] - recipients to
   *   drop from the final set AFTER union (rule roles ∪ userIds ∪ extras).
   *   Common use: the actor of the operation that emitted the event — they
   *   already know they did the thing, no need to notify themselves.
   * @param {string[]} [options.channelsOverride] - force channels instead of rule.channels.
   *
   * @example
   *   await notificationService.emit(tenantId, 'system.test', { triggeredBy: userId });
   */
  async emit(tenantId, event, payload = {}, options = {}) {
    requireTenant(tenantId);
    if (!event) return { dispatched: 0, recipients: [] };

    if (isRateLimited(tenantId)) {
      logger.warn('notificationService.emit rate-limited, dropping event', { tenantId, event });
      return { dispatched: 0, recipients: [], rateLimited: true };
    }

    const rule = await NotificationRule.findOne({ tenantId, event }).lean();
    if (!rule || !rule.enabled) {
      return { dispatched: 0, recipients: [] };
    }

    const roleRecipients = rule.recipients?.roles?.length
      ? await User.find({ tenantId, role: { $in: rule.recipients.roles } }, '_id').lean()
      : [];

    // Defense-in-depth: filter every explicit userId (from the rule OR from
    // options.extraRecipientUserIds) through User.find with tenantId. The
    // rule-service already validates on write, but callers of the bus from
    // future features may pass extraRecipientUserIds directly — this ensures
    // the bus itself cannot leak across tenants regardless of caller trust.
    const candidateUserIds = [
      ...(rule.recipients?.userIds || []).map((id) => String(id)),
      ...(options.extraRecipientUserIds || []).map((id) => String(id)),
    ].filter((id) => mongoose.isValidObjectId(id));
    const validExplicit = candidateUserIds.length
      ? await User.find(
          { _id: { $in: candidateUserIds }, tenantId, isDeleted: false },
          '_id'
        ).lean()
      : [];

    const recipientIds = new Set();
    roleRecipients.forEach((u) => recipientIds.add(String(u._id)));
    validExplicit.forEach((u) => recipientIds.add(String(u._id)));

    // Apply exclude AFTER the union — covers the actor who triggered the
    // event even when their role puts them in `rule.recipients.roles`.
    (options.excludeRecipientUserIds || []).forEach((id) => {
      recipientIds.delete(String(id));
    });

    if (recipientIds.size === 0) {
      return { dispatched: 0, recipients: [] };
    }

    const channels =
      Array.isArray(options.channelsOverride) && options.channelsOverride.length
        ? options.channelsOverride
        : rule.channels || [];
    if (channels.length === 0) {
      return { dispatched: 0, recipients: [] };
    }

    const preferences = await NotificationPreference.find({
      tenantId,
      userId: { $in: Array.from(recipientIds) },
      event,
    }).lean();
    const mutedByUser = new Map(preferences.map((p) => [String(p.userId), p.mutedChannels || []]));

    const { title, body, data, ...rest } = payload || {};
    const notifTitle = title || event;
    const notifBody = body || '';
    const notifData = data !== undefined ? data : rest;

    let dispatchedCount = 0;
    for (const userId of recipientIds) {
      try {
        const muted = mutedByUser.get(userId) || [];
        const activeChannels = channels.filter((c) => !muted.includes(c));

        for (const channel of activeChannels) {
          if (channel === 'email') {
            // TODO fase 2: Resend — channel is declared on the schema/rule
            // but not delivered yet (design.md Non-Goals).
            continue;
          }
          if (channel !== 'inapp') continue;

          const doc = await Notification.create({
            tenantId,
            userId,
            event,
            title: notifTitle,
            body: notifBody,
            data: notifData,
            channels: [channel],
          });
          dispatchedCount += 1;

          // Socket emission is best-effort: a socket-layer failure (or the
          // server not having initSocket()'d yet, e.g. in tests) must never
          // undo the persisted Notification or abort the fanout.
          try {
            socketBridge.getIO().to(`user:${userId}`).emit('notification', doc.toObject());
          } catch (socketErr) {
            logger.warn('notificationService.emit: socket emit failed', {
              tenantId, event, userId, err: String(socketErr),
            });
          }
        }
      } catch (err) {
        logger.error('notificationService.emit: recipient failed, continuing fanout', {
          tenantId, event, userId, err: String(err),
        });
      }
    }

    return { dispatched: dispatchedCount, recipients: Array.from(recipientIds) };
  }

  // =====================================================================
  // REST helpers — history / unread-count / mark-as-read (task 4.3)
  // =====================================================================

  async list({ tenantId, userId, page = 1, limit = 20, unread } = {}) {
    requireTenant(tenantId);
    if (!userId) throw new ApiError(401, 'No autenticado', 'NO_AUTH');

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (safePage - 1) * safeLimit;

    const query = { tenantId, userId };
    if (unread === true) query.readAt = null;

    const [data, total] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
      Notification.countDocuments(query),
    ]);

    const pages = Math.ceil(total / safeLimit) || 0;
    return {
      data,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages,
        hasNext: safePage < pages,
        hasPrev: safePage > 1,
      },
    };
  }

  async unreadCount({ tenantId, userId }) {
    requireTenant(tenantId);
    if (!userId) throw new ApiError(401, 'No autenticado', 'NO_AUTH');
    const count = await Notification.countDocuments({ tenantId, userId, readAt: null });
    return { count };
  }

  async markAsRead({ tenantId, userId, notificationId }) {
    requireTenant(tenantId);
    if (!mongoose.isValidObjectId(notificationId)) {
      throw new ApiError(404, 'Notificación no encontrada', 'NOT_FOUND', { id: notificationId });
    }
    const notification = await Notification.findOne({ _id: notificationId, tenantId, userId });
    if (!notification) {
      throw new ApiError(404, 'Notificación no encontrada', 'NOT_FOUND', { id: notificationId });
    }
    if (!notification.readAt) {
      notification.readAt = new Date();
      await notification.save();
    }
    return notification.toJSON ? notification.toJSON() : notification;
  }

  async markAllAsRead({ tenantId, userId }) {
    requireTenant(tenantId);
    if (!userId) throw new ApiError(401, 'No autenticado', 'NO_AUTH');
    const result = await Notification.updateMany(
      { tenantId, userId, readAt: null },
      { $set: { readAt: new Date() } }
    );
    return { modifiedCount: result.modifiedCount };
  }
}

export const notificationService = new NotificationService();
