import mongoose from 'mongoose';
import { ApiError } from '../utils/apiError.util.js';
import { multiplyMoney, sumMoney } from '../utils/money.util.js';
import {
  ABASTECIMIENTO_MODO_VALUES,
  APROBADOR_TIPO_VALUES,
  DEFAULT_CURRENCY,
  LINEA_ESTADO,
  LINEA_ESTADO_VALUES,
  NIVEL_ESTADO,
  NIVEL_ESTADO_VALUES,
  REQUISICION_ESTADO,
  REQUISICION_ESTADO_VALUES,
  REQUISICION_EVENTO_VALUES,
  REQUISICION_MAX_LINEAS,
  REQUISICION_PRIORIDAD,
  REQUISICION_PRIORIDAD_VALUES,
  TIMELINE_ACTOR_TIPO,
  TIMELINE_ACTOR_TIPO_VALUES,
} from '../constants/requisicion.constants.js';

const { Schema, model } = mongoose;

/**
 * Requisition document (change: requisiciones-e1-base-aprobacion). One document that changes of state; the state
 * only changes through requisicion.service.transition (group 4) in a single atomic write.
 *
 * Invariants enforced HERE (defence in depth, the service and DTOs enforce them too):
 *  - `timeline` is append-only: the only writer is `Requisicion.appendEvent` (`$push.$each`). Query/bulk hooks reject
 *    every other operator on the path, pipeline updates and replacements, and `save()` rejects a modified timeline
 *    on an existing document (design D3).
 *  - `tipoRequisicionId` never changes after creation (400 TIPO_INMUTABLE).
 *  - `consecutivo` and `tenantId` are immutable.
 *  - No physical deletion (soft delete only).
 *  - `montoEstimado` is derived from the lines on validation (`computeMontoEstimado`).
 *
 * Aggregations bypass the `pre(/^find/)` hook, so they must add `{ tenantId, isDeleted: false }` by hand.
 */

// --- Money / amount helper ------------------------------------------------------------------------------------

/** Sum of `cantidadSolicitada x precioEstimado` of the lines that are not cancelled, rounded to 2 decimals. */
export function computeMontoEstimado(lineas = []) {
  return sumMoney(
    (lineas || [])
      .filter((l) => l && l.estadoLinea !== LINEA_ESTADO.CANCELADA)
      .map((l) => multiplyMoney(l.cantidadSolicitada, l.precioEstimado)),
  );
}

// --- Timeline event builder -----------------------------------------------------------------------------------

/**
 * Builds a timeline entry. `actorId` null means a system actor.
 * @param {{ tipo: string, actorId?: any, estadoAnterior?: string, estadoNuevo?: string, observacion?: string, datos?: object, fecha?: Date }} event
 */
export function buildTimelineEvent({ tipo, actorId = null, estadoAnterior, estadoNuevo, observacion, datos, fecha } = {}) {
  if (!REQUISICION_EVENTO_VALUES.includes(tipo)) {
    throw new ApiError(500, `Evento de timeline desconocido: ${tipo}`, 'TIMELINE_EVENT_UNKNOWN');
  }
  const event = {
    eventId: new mongoose.Types.ObjectId(),
    tipo,
    fecha: fecha || new Date(),
    actor: actorId
      ? { tipo: TIMELINE_ACTOR_TIPO.USUARIO, usuarioId: actorId }
      : { tipo: TIMELINE_ACTOR_TIPO.SISTEMA },
  };
  if (estadoAnterior !== undefined) event.estadoAnterior = estadoAnterior;
  if (estadoNuevo !== undefined) event.estadoNuevo = estadoNuevo;
  if (observacion !== undefined && observacion !== null && observacion !== '') event.observacion = observacion;
  if (datos !== undefined) event.datos = datos;
  return event;
}

// --- Schema ---------------------------------------------------------------------------------------------------

const TimelineEventSchema = new Schema({
  eventId: { type: Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  tipo: { type: String, enum: REQUISICION_EVENTO_VALUES, required: true },
  fecha: { type: Date, default: Date.now },
  actor: {
    tipo: { type: String, enum: TIMELINE_ACTOR_TIPO_VALUES, default: TIMELINE_ACTOR_TIPO.USUARIO },
    usuarioId: { type: Schema.Types.ObjectId, ref: 'User' },
    nombreExterno: { type: String, trim: true },
  },
  estadoAnterior: { type: String, enum: REQUISICION_ESTADO_VALUES },
  estadoNuevo: { type: String, enum: REQUISICION_ESTADO_VALUES },
  observacion: { type: String, trim: true, maxlength: 2000 },
  datos: { type: Schema.Types.Mixed },
}, { _id: false });

const LineaSchema = new Schema({
  lineaId: { type: Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  descripcion: { type: String, required: true, trim: true, maxlength: 300 },
  especificaciones: { type: String, trim: true, maxlength: 1000 },
  unidad: { type: String, required: true, trim: true, maxlength: 30 },
  cantidadSolicitada: { type: Number, required: true, min: [0, 'cantidadSolicitada debe ser mayor que cero'], validate: { validator: (v) => v > 0, message: 'cantidadSolicitada debe ser mayor que cero' } },
  // Fulfilment fields: declared now, written by later epics (E2+). Never accepted from a payload.
  cantidadSurtida: { type: Number, default: 0, min: 0 },
  cantidadPendiente: { type: Number, default: 0, min: 0 },
  cantidadComprada: { type: Number, default: 0, min: 0 },
  cantidadRecibida: { type: Number, default: 0, min: 0 },
  inventarioItemId: { type: Schema.Types.ObjectId, ref: 'InventarioRepuesto', default: null },
  // Snapshot of the stock item when the line was saved; it does not change if the item changes later.
  snapshot: {
    nombre: { type: String, trim: true },
    referencia: { type: String, trim: true },
    unidad: { type: String, trim: true },
    precio: { type: Number },
  },
  precioEstimado: { type: Number, required: true, min: 0, default: 0 },
  moneda: { type: String, trim: true, uppercase: true, default: DEFAULT_CURRENCY },
  origenSolicitudRepuestoId: { type: Schema.Types.ObjectId, ref: 'Repuestos', default: null },
  estadoLinea: { type: String, enum: LINEA_ESTADO_VALUES, default: LINEA_ESTADO.PENDIENTE },
}, { _id: false });

const NivelSchema = new Schema({
  orden: { type: Number, required: true },
  nombre: { type: String, trim: true },
  reglaId: { type: Schema.Types.ObjectId, ref: 'ReglaAprobacion' },
  // Frozen snapshot of the rule at submission time.
  aprobadorTipo: { type: String, enum: APROBADOR_TIPO_VALUES, required: true },
  rolId: { type: Schema.Types.ObjectId, ref: 'Role', default: null },
  usuariosIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  montoDesde: { type: Number, default: 0 },
  montoHasta: { type: Number, default: null },
  // Users resolved as eligible when the level was frozen (head(s) of the requisition's area, listed users...).
  aprobadorIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  estado: { type: String, enum: NIVEL_ESTADO_VALUES, default: NIVEL_ESTADO.PENDIENTE },
  decididoPor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  fecha: { type: Date, default: null },
  observacion: { type: String, trim: true, maxlength: 2000 },
}, { _id: false });

const RequisicionSchema = new Schema({
  tenantId: { type: String, required: true, index: true, immutable: true },
  consecutivo: { type: String, required: true, trim: true, immutable: true },
  titulo: { type: String, required: true, trim: true, maxlength: 200 },
  // Chosen on creation and never changed (400 TIPO_INMUTABLE).
  tipoRequisicionId: { type: Schema.Types.ObjectId, ref: 'TipoRequisicion', required: true, immutable: true },
  areaId: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
  prioridad: { type: String, enum: REQUISICION_PRIORIDAD_VALUES, default: REQUISICION_PRIORIDAD.MEDIA },
  fechaRequerida: { type: Date, default: null },
  justificacion: { type: String, trim: true, maxlength: 2000 },
  estado: { type: String, enum: REQUISICION_ESTADO_VALUES, default: REQUISICION_ESTADO.BORRADOR },
  // Content version: +1 on every content edit and on every send / retire / reopen (approval re-freeze). Approve and
  // reject must echo it, so a decision is always bound to the content the approver saw (409 VERSION_DESACTUALIZADA).
  version: { type: Number, default: 1, min: 1 },
  creadaPor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  solicitanteId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lineas: {
    type: [LineaSchema],
    default: [],
    validate: {
      validator: (v) => Array.isArray(v) && v.length >= 1 && v.length <= REQUISICION_MAX_LINEAS,
      message: `La requisición debe tener entre 1 y ${REQUISICION_MAX_LINEAS} líneas`,
    },
  },
  // Derived in the server (pre-validate) from the lines; any client value is discarded.
  montoEstimado: { type: Number, default: 0, min: 0 },
  moneda: { type: String, trim: true, uppercase: true, default: DEFAULT_CURRENCY },
  aprobacion: {
    niveles: { type: [NivelSchema], default: [] },
    nivelActual: { type: Number, default: null },
  },
  // Minimal in E1; E2+ extend it.
  abastecimiento: {
    modo: { type: String, enum: ABASTECIMIENTO_MODO_VALUES, default: undefined },
    justificacionCompraDirecta: { type: String, trim: true, maxlength: 2000 },
  },
  enviadaAt: { type: Date, default: null },
  aprobadaAt: { type: Date, default: null },
  rechazadaAt: { type: Date, default: null },
  canceladaAt: { type: Date, default: null },
  canceladaPor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  canceladaMotivo: { type: String, trim: true, maxlength: 2000 },
  timeline: { type: [TimelineEventSchema], default: [] },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'requisiciones',
});

// --- Indexes --------------------------------------------------------------------------------------------------

RequisicionSchema.index({ tenantId: 1, isDeleted: 1 });
// Second defence of the atomic counter: a consecutivo is never reused inside a tenant.
RequisicionSchema.index({ tenantId: 1, consecutivo: 1 }, { unique: true });
RequisicionSchema.index({ tenantId: 1, estado: 1, createdAt: -1 });
RequisicionSchema.index({ tenantId: 1, areaId: 1, estado: 1 });
RequisicionSchema.index({ tenantId: 1, creadaPor: 1, createdAt: -1 });
RequisicionSchema.index({ tenantId: 1, estado: 1, 'aprobacion.nivelActual': 1 });
RequisicionSchema.index({ tenantId: 1, tipoRequisicionId: 1 });

// --- Derived amount -------------------------------------------------------------------------------------------

RequisicionSchema.pre('validate', function (next) {
  this.montoEstimado = computeMontoEstimado(this.lineas);
  // Untouched lines: the pending quantity starts as the requested one (later epics move it).
  for (const l of this.lineas || []) {
    if (!l.cantidadSurtida && !l.cantidadPendiente) l.cantidadPendiente = l.cantidadSolicitada;
  }
  next();
});

// --- Immutability guards --------------------------------------------------------------------------------------

const isTimelinePath = (path) => typeof path === 'string' && (path === 'timeline' || path.startsWith('timeline.') || path.startsWith('timeline['));
const isTipoPath = (path) => typeof path === 'string' && (path === 'tipoRequisicionId' || path.startsWith('tipoRequisicionId.'));

function timelineError(detail) {
  return new ApiError(409, `La línea de tiempo de la requisición es inmutable (solo se agregan eventos): ${detail}`, 'TIMELINE_INMUTABLE');
}

/** A legal append: `{ $each: [events] }` alone, or one plain event object. Modifiers ($position, $slice, $sort) are not. */
function isPlainAppend(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.includes('$each')) return keys.length === 1 && Array.isArray(value.$each);
  return !keys.some((k) => k.startsWith('$'));
}

/**
 * Inspects an update document. Returns an error (ApiError) when it would alter the timeline in any way other than
 * appending, change `tipoRequisicionId`, or is a pipeline update; null otherwise.
 * Exported for tests and for services that build raw updates.
 */
export function findForbiddenRequisicionUpdate(update) {
  if (update === null || update === undefined) return null;
  if (Array.isArray(update)) return timelineError('no se permiten actualizaciones con pipeline');
  if (typeof update !== 'object') return null;

  for (const [key, value] of Object.entries(update)) {
    if (!key.startsWith('$')) {
      // Mongoose treats top-level paths as an implicit $set.
      if (isTimelinePath(key)) return timelineError(`asignación directa de "${key}"`);
      if (isTipoPath(key)) return new ApiError(400, 'El tipo de requisición no puede cambiar', 'TIPO_INMUTABLE');
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    for (const [path, arg] of Object.entries(value)) {
      if (key === '$rename') {
        if (isTimelinePath(path) || isTimelinePath(String(arg))) return timelineError('$rename');
        if (isTipoPath(path) || isTipoPath(String(arg))) return new ApiError(400, 'El tipo de requisición no puede cambiar', 'TIPO_INMUTABLE');
        continue;
      }
      if (isTipoPath(path)) return new ApiError(400, 'El tipo de requisición no puede cambiar', 'TIPO_INMUTABLE');
      if (!isTimelinePath(path)) continue;
      if (key === '$push' && path === 'timeline' && isPlainAppend(arg)) continue;
      return timelineError(`${key} sobre "${path}"`);
    }
  }
  return null;
}

function guardUpdate(next) {
  const options = this.getOptions ? this.getOptions() : {};
  if (options && options.overwrite) return next(timelineError('reemplazo de documento'));
  const err = findForbiddenRequisicionUpdate(this.getUpdate());
  return next(err || undefined);
}

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
  RequisicionSchema.pre(op, guardUpdate);
}

// Replacements would overwrite the timeline.
for (const op of ['replaceOne', 'findOneAndReplace']) {
  RequisicionSchema.pre(op, function (next) {
    next(timelineError('reemplazo de documento'));
  });
}

// Requisitions are never physically deleted (soft delete: isDeleted = true).
const noPhysicalDelete = (next) => next(new ApiError(405, 'Las requisiciones no se eliminan físicamente (borrado lógico)', 'REQUISICION_NO_DELETE'));
for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove']) {
  RequisicionSchema.pre(op, noPhysicalDelete);
}
RequisicionSchema.pre('deleteOne', { document: true, query: false }, noPhysicalDelete);

RequisicionSchema.pre('bulkWrite', function (next, ops) {
  for (const op of Array.isArray(ops) ? ops : []) {
    if (op.replaceOne || op.deleteOne || op.deleteMany) return next(timelineError('operación de reemplazo o borrado en bulkWrite'));
    for (const kind of ['updateOne', 'updateMany']) {
      if (op[kind]) {
        const err = findForbiddenRequisicionUpdate(op[kind].update);
        if (err) return next(err);
      }
    }
  }
  return next();
});

RequisicionSchema.pre('save', function (next) {
  if (!this.isNew) {
    if (this.modifiedPaths().some((p) => isTimelinePath(p))) return next(timelineError('save() con timeline modificado'));
    if (this.isModified('tipoRequisicionId')) return next(new ApiError(400, 'El tipo de requisición no puede cambiar', 'TIPO_INMUTABLE'));
  }
  return next();
});

// --- Statics --------------------------------------------------------------------------------------------------

/**
 * The ONLY writer of the timeline: appends events with `$push.$each` in the same atomic write as the optional
 * `$set`/`$unset`/`$inc` of the transition. `filter` MUST carry `tenantId` (and, for transitions, the expected
 * `estado`); a null result means the condition did not hold (the caller decides 404 vs 409).
 *
 * @param {object} filter   e.g. { _id, tenantId, estado: 'Borrador' }
 * @param {object|object[]} events  entries built with `buildTimelineEvent`
 * @param {{ set?: object, unset?: object, inc?: object, arrayFilters?: object[], session?: any }} [extra]
 */
RequisicionSchema.statics.appendEvent = function appendEvent(filter, events, extra = {}) {
  if (!filter || !filter.tenantId) throw new Error('appendEvent requires tenantId in the filter');
  const list = (Array.isArray(events) ? events : [events]).filter(Boolean);
  if (list.length === 0) throw new Error('appendEvent requires at least one event');
  if (extra.inc && extra.inc.version) {
    // Legacy documents without `version` count as 1: seed it so `$inc` moves 1 -> 2 (a bare `$inc` on a missing field
    // would give 1 and a stale decision would still pass). Idempotent; only touches documents that match the guards.
    // `timestamps: false`: the seed must not bump `updatedAt`, which some callers use as an optimistic guard.
    const seedOptions = { timestamps: false, ...(extra.session ? { session: extra.session } : {}) };
    return this.updateOne({ $and: [filter, { version: { $exists: false } }] }, { $set: { version: 1 } }, seedOptions)
      .then(() => this.findOneAndUpdate(filter, buildUpdate(list, extra), buildOptions(extra)));
  }
  return this.findOneAndUpdate(filter, buildUpdate(list, extra), buildOptions(extra));
};

function buildUpdate(list, extra) {
  const update = { $push: { timeline: { $each: list } } };
  if (extra.set) update.$set = extra.set;
  if (extra.unset) update.$unset = extra.unset;
  if (extra.inc) update.$inc = extra.inc;
  return update;
}

function buildOptions(extra) {
  const options = { new: true, runValidators: true };
  if (extra.arrayFilters) options.arrayFilters = extra.arrayFilters;
  if (extra.session) options.session = extra.session;
  return options;
}

RequisicionSchema.statics.computeMontoEstimado = computeMontoEstimado;

// --- Serialization / soft delete filter -----------------------------------------------------------------------

RequisicionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

RequisicionSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

export const Requisicion = model('Requisicion', RequisicionSchema);
