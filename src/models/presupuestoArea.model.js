import mongoose from 'mongoose';
import { PERIODO_REGEX, DEFAULT_ALERT_THRESHOLD, DEFAULT_CURRENCY } from '../constants/requisicion.constants.js';

const { Schema, model } = mongoose;

/**
 * Informative budget of an area for a period (change: requisiciones-e1-base-aprobacion): year `YYYY` or month
 * `YYYY-MM`. The consumed / committed amounts are NEVER stored: presupuesto.service computes them by aggregation.
 * Unique per (tenant, area, period) among non-deleted rows.
 */
const PresupuestoAreaSchema = new Schema({
  tenantId: { type: String, required: true, index: true },
  areaId: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
  periodo: { type: String, required: true, trim: true, match: [PERIODO_REGEX, 'periodo debe ser YYYY o YYYY-MM'] },
  monto: { type: Number, required: true, min: 0 },
  moneda: { type: String, trim: true, uppercase: true, default: DEFAULT_CURRENCY },
  umbralAlerta: { type: Number, min: 1, max: 100, default: DEFAULT_ALERT_THRESHOLD },
  // Seeded default record (change: requisiciones-datos-por-defecto-tenant): protected, never writable through the API.
  esSistema: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'presupuestos-area',
});

PresupuestoAreaSchema.index({ tenantId: 1, isDeleted: 1 });
PresupuestoAreaSchema.index(
  { tenantId: 1, areaId: 1, periodo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

PresupuestoAreaSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

PresupuestoAreaSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

export const PresupuestoArea = model('PresupuestoArea', PresupuestoAreaSchema);
