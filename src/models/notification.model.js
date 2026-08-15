'use strict';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const NOTIFICATION_CHANNELS = ['inapp', 'email'];

// 90 days (design.md D5). MongoDB's TTL monitor purges automatically — no
// application-level cron/job needed.
const NOTIFICATION_TTL_SECONDS = 60 * 60 * 24 * 90;

/**
 * Notification — one document per (event, recipient), NOT per event with an
 * array of recipients (design.md D4). This keeps "unread of user X" an
 * O(log n) index scan (`{ tenantId, userId, readAt, createdAt }`) without
 * `$elemMatch`, and makes `readAt` trivially per-user.
 *
 * No `isDeleted`/soft-delete here — documented exception (backend-standards.md
 * §4, same category as `Counter` / audit logs): rows are immutable and
 * self-purge via the TTL index below. There is no user-facing "delete
 * notification" endpoint in phase 1, only "mark as read".
 */
const NotificationSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: { type: String, required: true, trim: true },
    title: { type: String, trim: true, default: '' },
    body: { type: String, trim: true, default: '' },
    data: { type: Schema.Types.Mixed, default: {} },
    // Which channel this specific row represents (design.md D4: one doc per
    // (recipient, channel) too — channels holds a single entry in practice,
    // kept as an array to mirror NotificationRule.channels/NotificationPreference.mutedChannels).
    channels: { type: [{ type: String, enum: NOTIFICATION_CHANNELS }], default: [] },
    readAt: { type: Date, default: null },
    // Manual createdAt (not `timestamps: true`) so the TTL index below can
    // target it directly without ambiguity.
    createdAt: { type: Date, default: () => new Date() },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: 'notifications',
  }
);

// Primary access pattern: "my (unread) notifications, most recent first" —
// GET /notifications, GET /notifications/unread-count, POST /notifications/read-all.
NotificationSchema.index({ tenantId: 1, userId: 1, readAt: 1, createdAt: -1 });

// TTL purge (design.md D5).
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS });

NotificationSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const Notification = model('Notification', NotificationSchema);
