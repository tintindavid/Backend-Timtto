import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const EstadoEquipoSchema = new Schema({
      tenantId: { type: String, required: true },
    Estado: { type: String, required: true, trim: true },
    Estado: { type: String, required: true, trim: true },
    Raznparaelestado: { type: String,  trim: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'estado-equipos'
});

// Indexes
// Indexes (tenant-aware)
EstadoEquipoSchema.index({ tenantId: 1, isDeleted: 1 });
EstadoEquipoSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
EstadoEquipoSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
EstadoEquipoSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const EstadoEquipo = model('EstadoEquipo', EstadoEquipoSchema);
