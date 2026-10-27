import mongoose from 'mongoose';
import { APROBADOR_TIPO, APROBADOR_TIPO_VALUES } from '../constants/requisicion.constants.js';

const { Schema, model } = mongoose;

/**
 * Approval rule = one approval LEVEL by amount (change: requisiciones-e1-base-aprobacion, design D6).
 * A rule applies to a requisition when `montoDesde <= montoEstimado` (cumulative); `montoHasta` (null = no limit) is
 * the authority limit of the level and is only used to validate that the configured ranges do not overlap.
 * The approver is the area head (`jefe_area`, taken from the requisition's area), the users of a tenant role
 * (`rol`) or a fixed list (`usuarios`).
 */
const ReglaAprobacionSchema = new Schema({
  tenantId: { type: String, required: true, index: true },
  orden: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'orden debe ser entero' } },
  nombre: { type: String, required: true, trim: true, maxlength: 120 },
  montoDesde: { type: Number, required: true, min: 0, default: 0 },
  // Informational authority limit (null = none). The range check (montoHasta > montoDesde) is NOT a path validator:
  // `this` is not the document in update validators. It lives in the pre('validate') document hook below (create) and
  // in reglaAprobacion.service (create and update, against the merged values).
  montoHasta: { type: Number, default: null, min: 0 },
  aprobadorTipo: { type: String, enum: APROBADOR_TIPO_VALUES, required: true },
  rolId: { type: Schema.Types.ObjectId, ref: 'Role', default: null },
  usuariosIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  activo: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'reglas-aprobacion',
});

ReglaAprobacionSchema.pre('validate', function (next) {
  if (this.montoHasta !== null && this.montoHasta !== undefined && !(this.montoHasta > this.montoDesde)) {
    this.invalidate('montoHasta', 'montoHasta debe ser mayor que montoDesde');
  }
  if (this.aprobadorTipo === APROBADOR_TIPO.ROL && !this.rolId) {
    this.invalidate('rolId', 'rolId es obligatorio para aprobadorTipo "rol"');
  }
  if (this.aprobadorTipo === APROBADOR_TIPO.USUARIOS && (!this.usuariosIds || this.usuariosIds.length === 0)) {
    this.invalidate('usuariosIds', 'usuariosIds es obligatorio para aprobadorTipo "usuarios"');
  }
  next();
});

ReglaAprobacionSchema.index({ tenantId: 1, isDeleted: 1 });
ReglaAprobacionSchema.index({ tenantId: 1, activo: 1, orden: 1 });

ReglaAprobacionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

ReglaAprobacionSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

export const ReglaAprobacion = model('ReglaAprobacion', ReglaAprobacionSchema);
