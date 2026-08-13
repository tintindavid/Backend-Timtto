'use strict';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * SheetWorkDownloadToken — one-off share link for a signed SheetWork.
 * See openspec/changes/sheetwork-share-and-portal-widening/design.md D1.
 *
 * Statuses:
 *   - active     : issued, downloads remaining, not expired.
 *   - exhausted  : `downloadsUsed >= downloadsAllowed` for the HT PDF.
 *   - expired    : `expiresAt <= now` (checked at request time; no Mongo TTL).
 *   - revoked    : manual invalidation.
 *
 * `unique` on `sheetId` guarantees one live share per sheet at a time —
 * reissue upserts on `sheetId` and counters reset.
 */
const SheetWorkDownloadTokenSchema = new Schema(
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
      enum: ['active', 'exhausted', 'expired', 'revoked'],
      default: 'active',
      index: true,
    },

    downloadsAllowed: { type: Number, default: 3 },
    downloadsUsed: { type: Number, default: 0 },

    allowReports: { type: Boolean, default: false },
    reportDownloadsAllowed: { type: Number, default: 2 },
    reportDownloadsUsed: { type: Number, default: 0 },

    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    issuedAt: { type: Date, default: Date.now },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'sheet_work_download_tokens',
  }
);

SheetWorkDownloadTokenSchema.index({ token: 1 }, { unique: true });
SheetWorkDownloadTokenSchema.index({ sheetId: 1 }, { unique: true });
SheetWorkDownloadTokenSchema.index({ tenantId: 1, clienteId: 1, status: 1 });

SheetWorkDownloadTokenSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

SheetWorkDownloadTokenSchema.set('toJSON', {
  virtuals: false,
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

export const SheetWorkDownloadToken = model('SheetWorkDownloadToken', SheetWorkDownloadTokenSchema);
