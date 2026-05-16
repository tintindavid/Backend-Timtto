import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const InventarioRepuestoSchema = new Schema({
  tenantId: { type: String, required: true },
  nombre: { type: String, required: true, trim: true },
  referencia: { type: String, trim: true },
  descripcion: { type: String, trim: true },
  stockActual: { type: Number, required: true, default: 0, min: 0 },
  stockMinimo: { type: Number, default: 0, min: 0 },
  unidad: { type: String, trim: true },
  precio: { type: Number, min: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'inventario-repuestos'
});

InventarioRepuestoSchema.index({ tenantId: 1, isDeleted: 1 });
InventarioRepuestoSchema.index({ tenantId: 1, nombre: 1 });

InventarioRepuestoSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

InventarioRepuestoSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const InventarioRepuesto = model('InventarioRepuesto', InventarioRepuestoSchema);
