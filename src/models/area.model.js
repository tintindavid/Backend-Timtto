import mongoose from 'mongoose';
import { AREA_MAX_JEFES } from '../constants/requisicion.constants.js';

const { Schema, model } = mongoose;

/**
 * Organizational area of a tenant (change: requisiciones-e1-base-aprobacion).
 * `codigo` is unique among non-deleted areas of the tenant and immutable; `nombre` is unique ignoring case
 * (collation index, the service gives the friendly 409). `jefesIds` are users of the same tenant (checked by the
 * service) and are who the `jefe_area` approval level resolves to.
 */
const AreaSchema = new Schema({
  tenantId: { type: String, required: true, index: true },
  nombre: { type: String, required: true, trim: true, maxlength: 120 },
  codigo: { type: String, required: true, trim: true, uppercase: true, maxlength: 30, immutable: true },
  descripcion: { type: String, trim: true, maxlength: 500 },
  jefesIds: {
    type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    default: [],
    validate: {
      validator: (v) => v.length <= AREA_MAX_JEFES,
      message: `Un área admite máximo ${AREA_MAX_JEFES} jefes`,
    },
  },
  activa: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'areas',
});

AreaSchema.index({ tenantId: 1, isDeleted: 1 });
AreaSchema.index({ tenantId: 1, codigo: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
AreaSchema.index(
  { tenantId: 1, nombre: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false }, collation: { locale: 'es', strength: 2 } },
);

AreaSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

AreaSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

export const Area = model('Area', AreaSchema);
