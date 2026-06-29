'use strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { QR_PASSWORD_BCRYPT_ROUNDS } from '../constants/serviceQr.constants.js';

const { Schema, model } = mongoose;

/**
 * ServiceQr — one QR identity per service location (Cliente x Sede x Servicio).
 *
 * Design references:
 *  - D1: standalone collection (not embedded in Servicios)
 *  - D2: tenantId is a String, not ObjectId
 *  - D3: references to existing collections keep their PascalCase field names
 *  - D5: unique partial index on (tenantId, ClienteId, sedeId, servicioId) where isDeleted=false
 *  - D6: passwordRotatedAt drives session invalidation
 *  - D17 (parallel): qrToken is a nanoid string, NOT an ObjectId
 *
 * The plain password is set transiently via a virtual setter; pre('save')
 * hashes it into `passwordHash`. `passwordHash` is removed from `toJSON`.
 */
const ServiceQrSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },

    // References to existing collections — preserve existing field names (D3).
    ClienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    sedeId: { type: Schema.Types.ObjectId, ref: 'Sedes', required: true },
    servicioId: { type: Schema.Types.ObjectId, ref: 'Servicios', required: true },

    qrToken: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },

    active: { type: Boolean, default: true },
    passwordRotatedAt: { type: Date, default: () => new Date() },

    /** Optional URL/path to a server-generated QR PNG (Open Question Q2 -> yes). */
    qrImageUrl: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Soft delete & audit
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'service_qrs',
  }
);

// ---------- Virtuals ----------
// Setting `password` triggers the hashing hook on save.
ServiceQrSchema.virtual('password')
  .set(function (plain) {
    this._plainPassword = plain;
  })
  .get(function () {
    return undefined;
  });

// ---------- Indexes ----------
// Unique active QR per (tenant, cliente, sede, servicio) — partial filter so
// soft-deleted records do not block re-creation (design D5).
ServiceQrSchema.index(
  { tenantId: 1, ClienteId: 1, sedeId: 1, servicioId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
ServiceQrSchema.index({ tenantId: 1, isDeleted: 1 });
ServiceQrSchema.index({ tenantId: 1, active: 1, isDeleted: 1 });
// qrToken lookups happen in public validate-access; high-cardinality, frequent.
ServiceQrSchema.index({ qrToken: 1 }, { unique: true });

// ---------- Hooks ----------
// Hash transient `password` (set via virtual) into `passwordHash` before save.
ServiceQrSchema.pre('save', async function (next) {
  if (!this._plainPassword) return next();
  try {
    const salt = await bcrypt.genSalt(QR_PASSWORD_BCRYPT_ROUNDS);
    this.passwordHash = await bcrypt.hash(this._plainPassword, salt);
    this._plainPassword = undefined;
    return next();
  } catch (err) {
    return next(err);
  }
});

// Default query excludes soft-deleted; pass { includeDeleted: true } via
// .setOptions() to opt out (used by historical ticket lookups).
ServiceQrSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) {
    this.where({ isDeleted: false });
  }
  next();
});

// Strip sensitive / internal fields from JSON output.
ServiceQrSchema.set('toJSON', {
  virtuals: false,
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

// ---------- Instance methods ----------
/**
 * Compare a plain text password against the stored hash.
 * Requires the document to be queried with `.select('+passwordHash')` since
 * the schema marks passwordHash with `select: false`.
 */
ServiceQrSchema.methods.comparePassword = async function (plain) {
  if (!plain || !this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

export const ServiceQr = model('ServiceQr', ServiceQrSchema);
