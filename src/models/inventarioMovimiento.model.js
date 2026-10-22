import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const MOVIMIENTO_TIPOS = Object.freeze(['entrada', 'salida', 'ajuste']);
export const MOVIMIENTO_REFERENCIA_TIPOS = Object.freeze(['manual', 'OT', 'reporte']);

/**
 * Stock movement (kardex) of an inventory item (change: inventario-stock). Advanced level only.
 * IMMUTABLE: rows are only inserted. There is no soft delete either; a mistake is corrected with an `ajuste`.
 *
 * `cantidad` is > 0 for entrada/salida; for `ajuste` it is a signed, non-zero delta.
 * `itemNombre` is a snapshot so the global kardex needs no join.
 */
const InventarioMovimientoSchema = new Schema({
  tenantId: { type: String, required: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'InventarioRepuesto', required: true },
  itemNombre: { type: String, trim: true },
  tipo: { type: String, enum: MOVIMIENTO_TIPOS, required: true },
  cantidad: { type: Number, required: true },
  stockAnterior: { type: Number, required: true, min: 0 },
  stockResultante: { type: Number, required: true, min: 0 },
  motivo: { type: String, trim: true, maxlength: 500 },
  referenciaTipo: { type: String, enum: MOVIMIENTO_REFERENCIA_TIPOS, default: 'manual' },
  referenciaId: { type: String, trim: true },
  usuarioId: { type: String, trim: true },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
  collection: 'inventario-movimientos',
});

InventarioMovimientoSchema.index({ tenantId: 1, createdAt: -1 });
InventarioMovimientoSchema.index({ tenantId: 1, itemId: 1, createdAt: -1 });
InventarioMovimientoSchema.index({ tenantId: 1, tipo: 1, createdAt: -1 });

function immutable(next) {
  next(new Error('Los movimientos de inventario son inmutables'));
}

for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove']) {
  InventarioMovimientoSchema.pre(op, immutable);
}
InventarioMovimientoSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Los movimientos de inventario son inmutables'));
  return next();
});

export const InventarioMovimiento = model('InventarioMovimiento', InventarioMovimientoSchema);
