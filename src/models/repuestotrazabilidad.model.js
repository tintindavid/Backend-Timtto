import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const RepuestoTrazabilidadSchema = new Schema({
    Status: { type: String, required: true, trim: true },
    Attachments: { type: String,  trim: true },
    Cantidad: { type: Number,  trim: true },
    Comentarios: { type: String,  trim: true },
    EstadoA: { type: String,  trim: true },
    EstadoActual: { type: String,  trim: true },
    EstadoAnterior: { type: String,  trim: true },
    EstadoNuevo: { type: String,  trim: true },
    FechaHoraCambio: { type: Date,  trim: true },
    SolicitudRepuestoId: { type: Schema.Types.ObjectId, ref: 'Repuestos', required: true },
      tenantId: { type: String, required: true },
    // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'repuesto-trazabilidads'
});

// Indexes (tenant-aware)
RepuestoTrazabilidadSchema.index({ tenantId: 1, isDeleted: 1 });
RepuestoTrazabilidadSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
RepuestoTrazabilidadSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
RepuestoTrazabilidadSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const RepuestoTrazabilidad = model('RepuestoTrazabilidad', RepuestoTrazabilidadSchema);
