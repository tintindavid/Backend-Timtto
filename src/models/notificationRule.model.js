'use strict';
import mongoose from 'mongoose';
import { NOTIFICATION_CHANNELS } from './notification.model.js';

const { Schema, model } = mongoose;

const NOTIFICATION_RULE_ROLES = ['admin', 'technician', 'user', 'superadmin'];

const RecipientsSchema = new Schema(
  {
    roles: { type: [{ type: String, enum: NOTIFICATION_RULE_ROLES }], default: [] },
    userIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { _id: false }
);

/**
 * NotificationRule — per-tenant, per-event configuration of who gets
 * notified and on which channels (design.md D6, D7). Exactly one rule per
 * (tenantId, event); admin-managed CRUD.
 */
const NotificationRuleSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    event: { type: String, required: true, trim: true },
    recipients: { type: RecipientsSchema, default: () => ({ roles: [], userIds: [] }) },
    // Allow-list ['inapp', 'email']; only 'inapp' has runtime effect in phase 1
    // (notification.service.js skips 'email' with a TODO — design.md D7 step 4).
    channels: { type: [{ type: String, enum: NOTIFICATION_CHANNELS }], default: ['inapp'] },
    enabled: { type: Boolean, default: true },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'notification_rules',
  }
);

// Unique per (tenant, event) among live rules — mirrors the partial-unique
// pattern used by user.model.js so a soft-deleted rule's event can be
// re-created without a manual purge.
NotificationRuleSchema.index(
  { tenantId: 1, event: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
NotificationRuleSchema.index({ tenantId: 1, isDeleted: 1 });

NotificationRuleSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

NotificationRuleSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

export const NotificationRule = model('NotificationRule', NotificationRuleSchema);
