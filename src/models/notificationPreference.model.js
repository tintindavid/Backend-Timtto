'use strict';
import mongoose from 'mongoose';
import { NOTIFICATION_CHANNELS } from './notification.model.js';

const { Schema, model } = mongoose;

/**
 * NotificationPreference — per-user opt-out override (design.md D6). A rule
 * decides the candidate recipient set; a preference filters channels OUT of
 * it. No rule -> no notification even if the user opts in (there is nothing
 * to opt into). No soft-delete: "un-muting" is just upserting `mutedChannels: []`,
 * there is no meaningful "deleted preference" state.
 */
const NotificationPreferenceSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: { type: String, required: true, trim: true },
    mutedChannels: { type: [{ type: String, enum: NOTIFICATION_CHANNELS }], default: [] },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'notification_preferences',
  }
);

NotificationPreferenceSchema.index({ tenantId: 1, userId: 1, event: 1 }, { unique: true });

NotificationPreferenceSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

export const NotificationPreference = model('NotificationPreference', NotificationPreferenceSchema);
