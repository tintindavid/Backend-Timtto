import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ServiciosSchema = new Schema({

    Cliente: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    nombre: { type: String, required: true, trim: true },
    observacion: { type: String,  trim: true },
    tenantId: { type: String, required: true },
    // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'servicios'
});

// Indexes
ServiciosSchema.index({ isDeleted: 1 });
  ServiciosSchema.index({ tenantId: 1, isDeleted: 1 });
  ServiciosSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
ServiciosSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
ServiciosSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const Servicios = model('Servicios', ServiciosSchema);
