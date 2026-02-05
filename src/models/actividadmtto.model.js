import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ActividadMttoSchema = new Schema({
  tenantId: { type: String, required: true },
    Descripcion: { type: String,  trim: true },
    EsObligatoria: { type: String,  trim: true },
    Nombre: { type: String,  trim: true },
    StatusReason: { type: String,  trim: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'actividad-mttos'
});

// Indexes (tenant-aware)
ActividadMttoSchema.index({ tenantId: 1, isDeleted: 1 });
ActividadMttoSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
ActividadMttoSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
ActividadMttoSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const ActividadMtto = model('ActividadMtto', ActividadMttoSchema);
