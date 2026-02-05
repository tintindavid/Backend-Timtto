/*No se va a usar por ahora, se dejo para futura implementacion de actividades por reporte*/
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ActividadReporteSchema = new Schema({
  tenantId: { type: String, required: true },
    Actividadreport: { type: String, required: true, trim: true },
    ActividadId: { type: Schema.Types.ObjectId, ref: 'Actividad', required: true },
    modificado: { type: Boolean,  trim: true },
    observacion: { type: String,  trim: true },
    Realizado: { type: Boolean,  trim: true },
    reportId: { type: Schema.Types.ObjectId, ref: 'Report', required: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'actividad-reportes'
});

// Indexes (tenant-aware)
ActividadReporteSchema.index({ tenantId: 1, isDeleted: 1 });
ActividadReporteSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
ActividadReporteSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
ActividadReporteSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const ActividadReporte = model('ActividadReporte', ActividadReporteSchema);
