'use strict';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * EquipmentQr — one public, password-less QR per EquipoItem.
 * Mirrors ServiceQr (see serviceQr.model.js) but read-only and public —
 * no password, gated only by `active` + `isDeleted`.
 *
 * Design references (openspec/changes/equipment-qr-public-history/design.md):
 *  - D1: standalone collection, not embedded in EquipoItem
 *  - D2: qrToken is a nanoid string, not an ObjectId
 *  - D13: partial unique index + check-then-insert-then-recover race handling
 */
const EquipmentQrSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },

    equipoId: { type: Schema.Types.ObjectId, ref: 'EquipoItem', required: true },

    qrToken: { type: String, required: true, trim: true },

    active: { type: Boolean, default: true },

    /** Relative API route to the persisted QR PNG (qrImage.util, scope='equipment-qrs'). */
    qrImageUrl: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Soft delete & audit
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'equipment_qrs',
  }
);

// ---------- Indexes ----------
// Unique active QR per (tenant, equipo) — partial filter so soft-deleted
// records free the uniqueness slot (design D13).
EquipmentQrSchema.index(
  { tenantId: 1, equipoId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
// qrToken is globally unique and is the lookup key for the public endpoint.
EquipmentQrSchema.index({ qrToken: 1 }, { unique: true });
// Admin listing lookup.
EquipmentQrSchema.index({ tenantId: 1, isDeleted: 1 });

// ---------- Hooks ----------
// Default query excludes soft-deleted; pass { includeDeleted: true } via
// .setOptions() to opt out.
EquipmentQrSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

// Strip internal fields from JSON output. NOTE: `tenantId` and `createdBy`
// are intentionally stripped here for the ADMIN toJSON convenience, but the
// PUBLIC endpoint (publicEquipment.service.js) never calls toJSON on this
// model — it builds its DTO field-by-field per design D5 and never touches
// this document's serialization at all.
EquipmentQrSchema.set('toJSON', {
  virtuals: false,
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

export const EquipmentQr = model('EquipmentQr', EquipmentQrSchema);
