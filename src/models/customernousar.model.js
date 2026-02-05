import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CustomerNoUsarSchema = new Schema({
  tenantId: { type: String, required: true },
  customernousarId: { type: String,  trim: true },
    CustomerPK: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    NombreCliente: { type: String, required: true, trim: true },
    Estado: { type: String, required: true, trim: true },
    Raznparaelestado: { type: String,  trim: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'customer-no-usars'
});

// Indexes (tenant-aware)
CustomerNoUsarSchema.index({ tenantId: 1, isDeleted: 1 });
CustomerNoUsarSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
CustomerNoUsarSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
CustomerNoUsarSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const CustomerNoUsar = model('CustomerNoUsar', CustomerNoUsarSchema);
