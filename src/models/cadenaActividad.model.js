import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const TIPOS_ACTIVIDAD_EXTERNA = [
  'calibracion', 'verificacion', 'ajuste', 'calificacion',
  'modernizacion', 'reacondicionamiento', 'actualizacion_sw_fw',
  'inspeccion_tecnica', 'auditoria_seguridad', 'otro',
];

const ESTADOS_CADENA = ['vigente', 'cerrada_manualmente', 'abandonada'];

const CadenaActividadSchema = new Schema({
  tenantId: { type: String, required: true },
  clienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  equipoId:  { type: Schema.Types.ObjectId, ref: 'EquipoItem', required: true },
  tipo:      { type: String, enum: TIPOS_ACTIVIDAD_EXTERNA, required: true },
  tipoCustom: { type: String, trim: true },
  frecuenciaMeses: { type: Number, min: 1 },
  esUnica: { type: Boolean, required: true, default: false },
  fechaProxima: { type: Date, default: null },
  estado: { type: String, enum: ESTADOS_CADENA, required: true, default: 'vigente' },
  actividadVigenteId: { type: Schema.Types.ObjectId, ref: 'EquipoActividadExterna', default: null },
  motivoCierre: { type: String, trim: true },
  cerradaPorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  cerradaAt: { type: Date, default: null },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true, collection: 'equipo-cadenas-actividad' });

CadenaActividadSchema.index({ tenantId: 1, equipoId: 1, tipo: 1, isDeleted: 1 });
CadenaActividadSchema.index({ tenantId: 1, equipoId: 1, estado: 1, isDeleted: 1 });
CadenaActividadSchema.index({ tenantId: 1, fechaProxima: 1 });
CadenaActividadSchema.index({ tenantId: 1, estado: 1, clienteId: 1 });

CadenaActividadSchema.pre('validate', function(next) {
  if (this.tipo === 'otro' && !this.tipoCustom) {
    this.invalidate('tipoCustom', 'tipoCustom es requerido cuando tipo = otro');
  }
  if (!this.esUnica && !this.frecuenciaMeses) {
    this.invalidate('frecuenciaMeses', 'frecuenciaMeses requerido cuando esUnica = false');
  }
  next();
});

CadenaActividadSchema.pre(/^find/, function(next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

CadenaActividadSchema.set('toJSON', {
  transform: (_doc, ret) => { delete ret.__v; delete ret.isDeleted; delete ret.deletedAt; return ret; },
});

export const CadenaActividad = model('CadenaActividad', CadenaActividadSchema);
