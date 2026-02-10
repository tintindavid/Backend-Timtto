import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ItemsSchema = new Schema({
    Nombre: { type: String, required: true, trim: true },
    Observacion: { type: String,  trim: true },
    ProtocoloId: { type: String,  trim: true },
    Precio: { type: Number,  trim: true },
    IvaIncluido: { type: Boolean, default: false },
    Iva: { type: Number,  trim: true },
    tenantId: { type: String, required: true },
      // Soft delete & audit
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'itemss'
});

// Indexes
ItemsSchema.index({ tenantId: 1, isDeleted: 1 });
ItemsSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
ItemsSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
ItemsSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const Items = model('Items', ItemsSchema);
