import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const OTSchema = new Schema({

    Consecutivo: { type: String, required: true, trim: true },
    ClienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    EstadoOt: { type: String, required: true, trim: true },
    FechaCreacion: { type: Date, required: true, trim: true },
    Norden: { type: String, required: true, trim: true },
    /* Tipo de servicio de mantenimiento es un Enum */
    TipoServicio: { type: String, enum: ['Preventivo', 'Correctivo', 'Predictivo', 'Instalacion', 'Proactivo'], required: true, trim: true },
    Avance: { type: Number,  trim: true },
    EstadoText: { type: String,  trim: true },
    numeroOt: { type: Number,  trim: true },
    /* Prioridad de la OT es un Enum */
    OtPrioridad: { type: String, enum: ['Baja', 'Media', 'Alta', 'Urgente'], required: true, trim: true },
    ResponsableId: { type: Schema.Types.ObjectId, ref: 'User'  ,  trim: true },
    tenantId: { type: String, required: true },
    reportes: [
      { 
        type: Schema.Types.ObjectId, 
        ref: 'Report',
        autopopulate: true,
      }
    ],
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'ots'
});

// Indexes
// Indexes (tenant-aware)
OTSchema.index({ tenantId: 1, isDeleted: 1 });
OTSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
OTSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
OTSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

// Try to apply mongoose-autopopulate if available (optional dependency)
import('mongoose-autopopulate')
  .then((m) => {
    const plugin = m && (m.default || m);
    if (plugin) OTSchema.plugin(plugin);
  })
  .catch(() => {
    // optional: plugin not installed, continue without autopopulate
  });
export const OT = model('OT', OTSchema);
