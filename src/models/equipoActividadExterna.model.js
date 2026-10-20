import mongoose from 'mongoose';
import { TIPOS_ACTIVIDAD_EXTERNA } from './cadenaActividad.model.js';

const { Schema, model } = mongoose;

export const ESTADOS_FINAL = ['aprobada', 'aprobada_con_observaciones', 'rechazada', 'pendiente', 'otro'];

const EvidenciaSchema = new Schema({
  url: { type: String, required: true },
  storagePath: { type: String, required: true },
  nombreOriginal: { type: String, required: true },
  mimetype: { type: String, required: true },
  tamanoBytes: { type: Number, required: true },
  uploadedAt: { type: Date, default: () => new Date() },
}, { _id: false });

const EquipoActividadExternaSchema = new Schema({
  tenantId: { type: String, required: true },
  clienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  equipoId: { type: Schema.Types.ObjectId, ref: 'EquipoItem', required: true },
  cadenaId: { type: Schema.Types.ObjectId, ref: 'CadenaActividad', required: true },
  tipo: { type: String, enum: TIPOS_ACTIVIDAD_EXTERNA, required: true },
  tipoCustom: { type: String, trim: true },
  consecutivoExterno: { type: String, required: true, trim: true },
  fecha: { type: Date, required: true },
  proveedor: { type: String, required: true, trim: true },
  // Optional link to a provider third party (Customer kind=provider). `proveedor` keeps a copy of the
  // name so history survives a later rename or deletion of the provider.
  proveedorId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  observacion: { type: String, trim: true },
  estadoFinal: { type: String, enum: ESTADOS_FINAL, required: true },
  estadoFinalCustom: { type: String, trim: true },
  evidencia: { type: EvidenciaSchema, default: undefined },
  enlace: {
    type: String,
    trim: true,
    validate: {
      validator: (v) => v == null || /^https?:\/\//i.test(v),
      message: 'enlace debe iniciar con http(s)://',
    },
  },
  esInicioCadena: { type: Boolean, required: true },
  cerradaAt: { type: Date, default: null },
  cerradaPorActividadId: { type: Schema.Types.ObjectId, ref: 'EquipoActividadExterna', default: null },
  createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true, collection: 'equipo-actividades-externas' });

EquipoActividadExternaSchema.index({ tenantId: 1, equipoId: 1, fecha: -1 });
EquipoActividadExternaSchema.index({ tenantId: 1, cadenaId: 1, fecha: 1 });
EquipoActividadExternaSchema.index({ tenantId: 1, cadenaId: 1, cerradaAt: 1 });

EquipoActividadExternaSchema.pre('validate', function(next) {
  if (this.fecha && this.fecha.getTime() > Date.now()) {
    this.invalidate('fecha', 'fecha no puede ser futura');
  }
  if (this.estadoFinal === 'otro' && !this.estadoFinalCustom) {
    this.invalidate('estadoFinalCustom', 'estadoFinalCustom requerido cuando estadoFinal = otro');
  }
  if (this.tipo === 'otro' && !this.tipoCustom) {
    this.invalidate('tipoCustom', 'tipoCustom requerido cuando tipo = otro');
  }
  next();
});

EquipoActividadExternaSchema.pre(/^find/, function(next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

EquipoActividadExternaSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    if (ret.evidencia) delete ret.evidencia.storagePath;
    return ret;
  },
});

export const EquipoActividadExterna = model('EquipoActividadExterna', EquipoActividadExternaSchema);
