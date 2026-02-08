import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const SedesSchema = new Schema({
    tenantId: { type: String, required: true },
    Cliente: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    contact: { type: String, required: true, trim: true },
    departamento: { type: String, required: true, trim: true },
    nombreSede: { type: String, required: true, trim: true },
    telefono: { type: String, required: true, trim: true },
    ciudad: { type: String,  trim: true },
    direccion: { type: String,  trim: true },
    email: { type: String,  trim: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'sedess'
});

// Indexes (tenant-aware)
SedesSchema.index({ tenantId: 1, isDeleted: 1 });
SedesSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
SedesSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
SedesSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const Sedes = model('Sedes', SedesSchema);
