import mongoose from 'mongoose';
import { REPUESTO_DISPONIBILIDAD_VALUES } from '../constants/requisicion.constants.js';

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
    // Additive, optional, NO default (requisiciones-e1-base-aprobacion, design D15). Declared here but written only by
    // the Requisiciones module in E2; never accepted from the request DTOs and never serialized by this model's toJSON.
    requisicion: {
      type: new Schema({
        requisicionId: { type: Schema.Types.ObjectId, ref: 'Requisicion' },
        lineaId: { type: Schema.Types.ObjectId },
        // E2: denormalized summary of the link (written only by requisicionSolicitudSync / the conversion service).
        consecutivo: { type: String, trim: true },
        disponibilidad: { type: String, enum: REPUESTO_DISPONIBILIDAD_VALUES },
        cantidadConfirmada: { type: Number, min: 0 },
      }, { _id: false }),
      default: undefined,
    },
    stockDescontadoPor: { type: String, enum: ['requisicion'], default: undefined },
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
// E2: solicitudes linked to a requisition (sync service, eligibility checks).
RepuestosSchema.index({ tenantId: 1, 'requisicion.requisicionId': 1 });

// Exclude sensitive fields
RepuestosSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    // Requisiciones fields are not part of the Repuestos contract until E2 exposes them behind the capability.
    delete ret.requisicion;
    delete ret.stockDescontadoPor;
    return ret;
  }
});

// Default exclude soft-deleted
RepuestosSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const Repuestos = model('Repuestos', RepuestosSchema);
