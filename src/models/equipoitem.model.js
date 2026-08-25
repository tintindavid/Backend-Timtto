import mongoose from 'mongoose';
import { normalizeSerial, serialHasDigit } from '../utils/serial.util.js';
import { EstadoOperativoValues, EstadoOperativoDefault, EstadoOperativoSources } from '../constants/estadoOperativo.js';

const { Schema, model } = mongoose;

/**
 * Append-only history of `EstadoOperativo` transitions (design.md D2,
 * equipo-estado-operativo-editable-y-cronograma-excel). Entries are never
 * mutated — every change pushes a new one via
 * `equipoItemService._appendEstadoOperativoHistory`. Same idiom as
 * `programaciones[]` on `OT` (ScheduleEntrySchema).
 */
const EstadoOperativoHistoryEntrySchema = new Schema(
  {
    from: { type: String, enum: EstadoOperativoValues, default: null },
    to: { type: String, enum: EstadoOperativoValues, required: true },
    motivo: { type: String, trim: true, default: null, maxlength: 500 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changedByName: { type: String, trim: true, required: true },
    source: { type: String, enum: EstadoOperativoSources, required: true },
    reportId: { type: Schema.Types.ObjectId, ref: 'Report', default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const EquipoItemSchema = new Schema({
    tenantId: { type: String, required: true },
    ClienteId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    Estado: { type: String, required: true, trim: true },
    // se actualiza cuando se cierra un reporte o se edita un equipo — toda
    // mutación DEBE pasar por equipoItemService._appendEstadoOperativoHistory
    EstadoOperativo: { type: String, enum: EstadoOperativoValues, default: EstadoOperativoDefault, trim: true },
    estadoOperativoHistory: { type: [EstadoOperativoHistoryEntrySchema], default: [] },
    ItemId: { type: Schema.Types.ObjectId, ref: 'Items', required: true},
    Marca: { type: String, required: true, trim: true },
    SedeId: { type: Schema.Types.ObjectId, ref: 'Sedes', required: true },
    Serie: { type: String, required: true, trim: true },
    // Derived, comparison-only normalization of `Serie` (trim + collapse
    // spaces + upper-case). null when the normalized serial has no digit —
    // see equipo-duplicate-detection-and-replace design.md D2/D3.
    SerieNormalized: { type: String, default: null },
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

// Compound partial unique index enforcing conditional uniqueness on
// (tenantId, ClienteId, ItemId, Marca, SerieNormalized) — only when the
// normalized serial is digit-bearing and the row is not soft-deleted.
// Created live only after the backfill runs and reports zero pre-existing
// duplicates. Safe to leave in code for fresh DBs; existing envs need the
// follow-up migration (see design.md D9 / Migration Plan, tasks.md 14.3).
EquipoItemSchema.index(
  { tenantId: 1, ClienteId: 1, ItemId: 1, Marca: 1, SerieNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { SerieNormalized: { $type: 'string' }, isDeleted: false },
    name: 'equipoitem_dedupe_partial',
  }
);

// Exclude sensitive fields. SerieNormalized is intentionally kept (not
// deleted) in the JSON output — it's helpful for admins/debugging and is
// not sensitive.
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

// Recompute SerieNormalized whenever Serie changes (or on insert).
EquipoItemSchema.pre('save', function (next) {
  if (this.isNew || this.isModified('Serie')) {
    const normalized = normalizeSerial(this.Serie || '');
    this.SerieNormalized = serialHasDigit(normalized) ? normalized : null;
  }
  next();
});

// Recompute SerieNormalized on findOneAndUpdate (findByIdAndUpdate uses this
// under the hood) whenever the update touches `Serie`. Handles both the
// `{ $set: { Serie } }` and plain-object `{ Serie }` update forms accepted
// by Mongoose 8. Does NOT recompute when only `Marca` changes — the partial
// unique index catches Marca-only collisions on its own.
EquipoItemSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  const hasSetSerie = update.$set && Object.prototype.hasOwnProperty.call(update.$set, 'Serie');
  const hasTopLevelSerie = !hasSetSerie && Object.prototype.hasOwnProperty.call(update, 'Serie');

  if (hasSetSerie || hasTopLevelSerie) {
    const rawSerie = hasSetSerie ? update.$set.Serie : update.Serie;
    const normalized = normalizeSerial(rawSerie || '');
    const serieNormalized = serialHasDigit(normalized) ? normalized : null;

    if (!update.$set) update.$set = {};
    update.$set.SerieNormalized = serieNormalized;
    this.setUpdate(update);
  }
  next();
});

export const EquipoItem = model('EquipoItem', EquipoItemSchema);
