import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const EquipoItemSchema = new Schema({
    tenantId: { type: String, required: true },
    ClienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    Estado: { type: String, required: true, trim: true },
    EstadoOperativo: { type: String, default: 'Operativo', trim: true }, // se actualiza cuando se cierra un reporte o se edita un equipo 
    ItemId: { type: Schema.Types.ObjectId, ref: 'Items', required: true},
    Marca: { type: String, required: true, trim: true },
    SedeId: { type: Schema.Types.ObjectId, ref: 'Sedes', required: true },
    Serie: { type: String, required: true, trim: true },
    Servicio: { type: Schema.Types.ObjectId, ref: 'Servicios', required: true},
    Ubicacion: { type: String,  trim: true },
    Cronograma: { type: String,  trim: true },
    Inventario: { type: String,  trim: true }, 
    item: { type: String,  trim: true },
    Meses: { type: String,  trim: true },
    mesesMtto: [{ type: String, trim: true }],  // Array of maintenance months
    mesesMttoRealizados: [{     // array que almacena los meses de mantenimiento realizados
      fecha: { type: Date }, 
      mes: { type: String, trim: true },
      consecutivo: { type: String, trim: true }
    }],  // Array of completed maintenance months
    ProximoMtto: { type: String,  trim: true },  // campo que se actualiza con el próximo mes de mantenimiento cuando se cierra un reporte
    Modelo: { type: String,  trim: true },
    UltimoConsecutivoMtto: { type: String,  trim: true },
    UltimoMtto: { type: Date },
    Riesgo: { type: String, trim: true },
    Invima: { type: String, trim: true },
    Precio: { type: Number },
    TieneHV: { type: Boolean, default: false },
    HVAprovada: { type: Boolean, default: false },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'equipo-items'
});

// Indexes
EquipoItemSchema.index({ isDeleted: 1 });
EquipoItemSchema.index({ tenantId: 1, isDeleted: 1 });
EquipoItemSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
EquipoItemSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
EquipoItemSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const EquipoItem = model('EquipoItem', EquipoItemSchema);
