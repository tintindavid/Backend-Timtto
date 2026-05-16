import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const RepuestosSchema = new Schema({
  tenantId: { type: String, required: true },
    ClienteId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    Cantidad: { type: String, required: true, trim: true },
    nombre: { type: String, required: true, trim: true },
    CantidadInstalacion: { type: Number,  trim: true },
    Currency: { type: String,  trim: true },
    EquipoId: { type: Schema.Types.ObjectId, ref: 'EquipoItem', required: true },
    EstadoAnterior: { type: String,  trim: true },
    EstadoSolicitud: { type: String,  trim: true },
    ExchangeRate: { type: Number,  trim: true },
    FechaInstalacion: { type: Date,  trim: true },
    FechaSolicitud: { type: Date,  trim: true },
    observacion: { type: String,  trim: true },
    ObservacionInstalacion: { type: String,  trim: true },
    OrdenId: { type: Schema.Types.ObjectId, ref: 'OT', required: true },
    origenRepuesto: { type: String,  trim: true },
    PrecioRepuesto: { type: Number,  trim: true },
    Prioridad: { type: String,  trim: true },
    InventarioItemId: { type: Schema.Types.ObjectId, ref: 'InventarioRepuesto' },
    ReporteInstalacionId: { type: Schema.Types.ObjectId, ref: 'Report' },
    ReporteSolicitudId: { type: Schema.Types.ObjectId, ref: 'Report', required: true },
    ResponsableInstalacion: { type: Schema.Types.ObjectId, ref: 'User' },
    ResponsableSolicitud: { type: Schema.Types.ObjectId, ref: 'User',  required: true },
    FrecuenciaDeCambio: { type: Number,  trim: true }, // en meses o según criterio del cliente
    Fotos: [{ type: String,  trim: true }], // array de URLs o paths a las fotos
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'repuestos'
});

// Indexes (tenant-aware)
RepuestosSchema.index({ tenantId: 1, isDeleted: 1 });
RepuestosSchema.index({ tenantId: 1, createdAt: -1 });
RepuestosSchema.index({ tenantId: 1, EstadoSolicitud: 1, ClienteId: 1 });

// Exclude sensitive fields
RepuestosSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
RepuestosSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const Repuestos = model('Repuestos', RepuestosSchema);
