import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const SheetWorkSchema = new Schema({
  tenantId: { type: String, required: true },
  clienteId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  otId: { type: Schema.Types.ObjectId, ref: 'OT', required: true },
  cargoRecibe: { type: String,  trim: true },
  firmaFile: { type: String,  trim: true },
  firmaResponsable: { type: String,  trim: true },
  numeroHoja: { type: String,  trim: true },
  PdfGenerado: { type: Boolean,  trim: true },
  PdfHojaTrabajo: { type: String,  trim: true },
  personaRecibe: { type: String,  trim: true },
  responsable: { type: Schema.Types.ObjectId, ref: 'User' },
  fullNameResponsable: { type: String,  trim: true },
  cargoResponsable: { type: String,  trim: true },
  firmaResponsableFile: { type: String,  trim: true },
  observaciones: { type: String, trim: true },
  reports: [
    { type: Schema.Types.ObjectId, ref: 'Report' }
  ],
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'sheet-works'
});

// Indexes (tenant-aware)
SheetWorkSchema.index({ tenantId: 1, isDeleted: 1 });
SheetWorkSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
SheetWorkSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
SheetWorkSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const SheetWork = model('SheetWork', SheetWorkSchema);
