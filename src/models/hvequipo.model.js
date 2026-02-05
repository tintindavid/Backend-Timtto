import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const HVEquipoSchema = new Schema({

    EquipoId: { type: Schema.Types.ObjectId, ref: 'Equipo', required: true },
    clienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    NombreEquipo: { type: String, required: true, trim: true },
    Estado: { type: String, required: true, trim: true },
    Accesorios: { type: String,  trim: true },
    tenantId: { type: String, required: true },
    AnoFabricacion: { type: Number,  trim: true },
    rea: { type: String,  trim: true },
    ClasificacinRiesgo: { type: String,  trim: true },
    Corriente: { type: String,  trim: true },
    Customer: { type: String,  trim: true },
    DireccinProveedor: { type: String,  trim: true },
    Divisa: { type: String,  trim: true },
    DocumentoAdjunto: { type: String,  trim: true },
    EmailProveedor: { type: String,  trim: true },
    EquipoId: { type: String,  trim: true },
    equipoItem: { type: String,  trim: true },
    Estado: { type: String,  trim: true },
    EstadoEquipo: { type: String,  trim: true },
    EstadoHV: { type: String,  trim: true },
    Fabricante: { type: String,  trim: true },
    FechaAdquisicin: { type: Date,  trim: true },
    FechaCreacin: { type: Date,  trim: true },
    FechaFinGaranta: { type: Date,  trim: true },
    FechaInicioGaranta: { type: Date,  trim: true },
    FechaInstalacin: { type: Date,  trim: true },
    FechaPuestaFuncionamiento: { type: Date,  trim: true },
    Frecuencia: { type: String,  trim: true },
    FuenteAlimentacin: { type: String,  trim: true },
    HumedadOperacin: { type: String,  trim: true },
    Marca: { type: String,  trim: true },
    Modelo: { type: String,  trim: true },
    NombreCliente: { type: String,  trim: true },
    NombreProveedor: { type: String,  trim: true },
    NmeroSerie: { type: String,  trim: true },
    Observaciones: { type: String,  trim: true },
    PasOrigen: { type: String,  trim: true },
    PeriodicidadCalibracin: { type: String,  trim: true },
    PeriodicidadMantenimiento: { type: String,  trim: true },
    Peso: { type: Number,  trim: true },
    Potencia: { type: String,  trim: true },
    PresinOperacin: { type: String,  trim: true },
    PrximaCalibracin: { type: Date,  trim: true },
    PrximoMantenimiento: { type: Date,  trim: true },
    Raznparaelestado: { type: String,  trim: true },
    Recomendaciones: { type: String,  trim: true },
    RegistroINVIMA: { type: String,  trim: true },
    RequiereCalibracin: { type: Boolean,  trim: true },
    Servicio: { type: String,  trim: true },
    TecnologaPredominante: { type: String,  trim: true },
    TelfonoProveedor: { type: String,  trim: true },
    TemperaturaOperacin: { type: String,  trim: true },
    TipoAdquisicin: { type: String,  trim: true },
    Tipodecambio: { type: Number,  trim: true },
    TipoEquipo: { type: String,  trim: true },
    UsoEquipo: { type: String,  trim: true },
    Usuario: { type: String,  trim: true },
    ValorAdquisicin: { type: Number,  trim: true },
    Version: { type: String,  trim: true },
    Voltaje: { type: String,  trim: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'hvequipos'
});

// Indexes
// Indexes (tenant-aware)
HVEquipoSchema.index({ tenantId: 1, isDeleted: 1 });
HVEquipoSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
HVEquipoSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
HVEquipoSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const HVEquipo = model('HVEquipo', HVEquipoSchema);
