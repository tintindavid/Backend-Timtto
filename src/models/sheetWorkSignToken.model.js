'use strict';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * SheetWorkSignToken — opaque nanoid(32) link granting a client the right to
 * remotely sign one specific SheetWork. Sibling to ClientAccessToken but
 * scoped to a single sheet and time-bound (7-day sliding TTL, renewed on
 * sign). See openspec/changes/sheetwork-remote-signature/design.md D1-D3.
 *
 * Statuses:
 *   - active     : issued, awaiting signature.
 *   - signed     : sheet was signed via this token; the link now serves the
 *                  read-only download view until expiresAt.
 *   - expired    : left in DB for audit after expiresAt (checked at request
 *                  time; no Mongo TTL — history is kept for the audit trail).
 *   - revoked    : manually invalidated.
 *   - superseded : the sheet was closed via the admin in-place fallback;
 *                  the previously shared link is dead.
 *
 * `unique` on `sheetId` guarantees one token per sheet at any time — the
 * resend path upserts on `sheetId` instead of creating duplicates.
 */
const SheetWorkSignTokenSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    sheetId: { type: Schema.Types.ObjectId, ref: 'SheetWork', required: true },
    otId: { type: Schema.Types.ObjectId, ref: 'OT', required: true },
    clienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },

    email: { type: String, required: true, trim: true, lowercase: true },

    token: { type: String, required: true, trim: true },
    expiresAt: { type: Date, required: true, index: true },

    status: {
      type: String,
      enum: ['active', 'signed', 'expired', 'revoked', 'superseded'],
      default: 'active',
      index: true,
    },

    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, default: Date.now },
    message: { type: String, trim: true, default: null, maxlength: 500 },
    resendCount: { type: Number, default: 0 },

    signedAt: { type: Date, default: null },
    signedIp: { type: String, trim: true, default: null },
    signedUserAgent: { type: String, trim: true, default: null },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'sheet_work_sign_tokens',
  }
);

SheetWorkSignTokenSchema.index({ token: 1 }, { unique: true });
SheetWorkSignTokenSchema.index({ sheetId: 1 }, { unique: true });
SheetWorkSignTokenSchema.index({ tenantId: 1, clienteId: 1, status: 1 });
SheetWorkSignTokenSchema.index({ tenantId: 1, createdAt: -1 });

SheetWorkSignTokenSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

SheetWorkSignTokenSchema.set('toJSON', {
  virtuals: false,
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

export const SheetWorkSignToken = model('SheetWorkSignToken', SheetWorkSignTokenSchema);
