import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Configurable requisition type (change: requisiciones-e1-base-aprobacion). `codigo` is immutable and unique among
 * the tenant's non-deleted types; a requisition's `tipoRequisicionId` never changes after creation.
 */
const TipoRequisicionSchema = new Schema({
  tenantId: { type: String, required: true, index: true },
  nombre: { type: String, required: true, trim: true, maxlength: 120 },
  codigo: { type: String, required: true, trim: true, uppercase: true, maxlength: 30, immutable: true },
  descripcion: { type: String, trim: true, maxlength: 500 },
  activo: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'tipos-requisicion',
});

TipoRequisicionSchema.index({ tenantId: 1, isDeleted: 1 });
TipoRequisicionSchema.index({ tenantId: 1, codigo: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
TipoRequisicionSchema.index(
  { tenantId: 1, nombre: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false }, collation: { locale: 'es', strength: 2 } },
);

TipoRequisicionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

TipoRequisicionSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

export const TipoRequisicion = model('TipoRequisicion', TipoRequisicionSchema);
