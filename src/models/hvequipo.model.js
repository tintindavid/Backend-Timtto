import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const HVEquipoSchema = new Schema({
    EquipoId:  { type: Schema.Types.ObjectId, ref: 'EquipoItem',  trim: true },
    clienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    equipoSnapshot:
      {
        ItemText: { type: String,  trim: true },
        Marca: { type: String,  trim: true },
        Modelo: { type: String,  trim: true },
        Sede: { type: String,  trim: true },
        Serie: { type: String,  trim: true },
        Inventario: { type: String,  trim: true },
        Servicio: { type: String,  trim: true },
        Ubicacion: { type: String,  trim: true },
        MesesMtto: [{ type: String, trim: true }],
      },
    Accesorios: [
      {
        nombre: { type: String,  trim: true },
        descripcion: { type: String,  trim: true },
        cantidad: { type: Number,  trim: true },
        estado: { type: String,  trim: true },
        observaciones: { type: String,  trim: true },
      }
    ],
    TecnologiaPredominante: { type: String,  trim: true },
    tenantId: { type: String, required: true },
    AnoFabricacion: { type: Number,  trim: true },
    AutonomiaBatería: { type: String,  trim: true },
    ClasificacinRiesgo: { type: String,  trim: true },
    Corriente: { type: String,  trim: true },
    CiudadProveedor: { type: String,  trim: true },
    Descripcion: { type: String,  trim: true },
    DireccionProveedor: { type: String,  trim: true },
    DocumentoAdjunto: { type: String,  trim: true },
    EmailProveedor: { type: String,  trim: true },
    EstadoHV: { type: String,  default: 'Guardada', trim: true }, // Si es un HV, aprobada, que se puede usar como referencia para otros equipos
    Fabricante: { type: String,  trim: true },
    FechaAdquisicin: { type: Date,  trim: true },
    FechaCreacion: { type: Date,  trim: true },
    FechaFinGarantia: { type: Date,  trim: true },
    FechaInicioGarantia: { type: Date,  trim: true },
    FechaInstalacion: { type: Date,  trim: true },
    FechaPuestaFuncionamiento: { type: Date,  trim: true },
    FechaFuncionamiento: { type: Date,  trim: true },
    Frecuencia: { type: String,  trim: true },
    FuenteAlimentacion: { type: String,  trim: true },
    HumedadOperacion: { type: String,  trim: true },
    NombreCliente: { type: String,  trim: true },
    NombreProveedor: { type: String,  trim: true },
    Observaciones: { type: String,  trim: true },
    PaisOrigen: { type: String,  trim: true },
    RequiereCalibracion: { type: Boolean,  trim: true },
    PeriodicidadCalibracion: { type: String,  trim: true },
    PeriodicidadMantenimiento: { type: String,  trim: true },
    Peso: { type: Number,  trim: true },
    Potencia: { type: String,  trim: true },
    PresionOperacion: { type: String,  trim: true },
    Recomendaciones: [{ type: String, trim: true }],
    RegistroINVIMA: { type: String,  trim: true },
    Servicio: { type: String,  trim: true },
    ManualDisponible: { type: Boolean, default: false },
    PlanoDisponible: { type: Boolean, default: false },
    RequiereCapacitacion: { type: Boolean, default: false },
    TelefonoProveedor: { type: String,  trim: true },
    TemperaturaOperacion: { type: String,  trim: true },
    TipoAdquisicion: { type: String,   trim: true }, // Compra, Leasing, Donación, Alquiler
    TipoEquipo: { type: String,  trim: true }, 
    UsoEquipo: { type: String, enum:['Apoyo', 'Soporte', 'Produccion', 'Investigacion', 'Docencia'],  trim: true }, // Apoyo / Soporte/Produccion/Investigacion/Docencia
    ValorAdquisicion: { type: Number,  trim: true },
    Software: { type: String,  trim: true },
    Version: { type: String,  trim: true },
    Voltaje: { type: String,  trim: true },
    userIdCreacion: { type: Schema.Types.ObjectId, ref: 'User',  trim: true },
    UserIdAprobacion: { type: Schema.Types.ObjectId, ref: 'User',  trim : true },
    UserAprobacion: { type: String,  trim: true },
    CargoUserAprobacion: { type: String,  trim: true },
    FirmAprobacion: { type: String,  trim: true },
    FechaAprobacion: { type: Date,  trim: true },
    ResponsableCustomer: { type: String,  trim: true },
    CargoResponsableCustomer: { type: String,  trim: true },
    FirmaResponsableCustomer: { type: String,  trim: true },
    Foto: { type: String,  trim: true },
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

// Pre-save hook: Normalizar Recomendaciones a array si viene como string
HVEquipoSchema.pre('save', function(next) {
  if (this.Recomendaciones && typeof this.Recomendaciones === 'string') {
    this.Recomendaciones = [this.Recomendaciones];
  }
  next();
});

// Pre-update hook: Normalizar Recomendaciones en updates
HVEquipoSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function(next) {
  const update = this.getUpdate();
  if (update.$set && update.$set.Recomendaciones && typeof update.$set.Recomendaciones === 'string') {
    update.$set.Recomendaciones = [update.$set.Recomendaciones];
  }
  next();
});

// Default exclude soft-deleted
HVEquipoSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const HVEquipo = model('HVEquipo', HVEquipoSchema);
