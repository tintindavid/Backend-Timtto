import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CustomerSchema = new Schema({
    Razonsocial: { type: String, required: true, trim: true },
    Ciudad: { type: String, required: true, trim: true },
    Departamento: { type: String, required: true, trim: true },
    Email: { type: String, required: true, trim: true },
    Nit: { type: Number, required: true, trim: true },
    Direccion: { type: String,  trim: true }, 
    Logo: { type: String,  trim: true }, 
    TelContacto: { type: String,  trim: true },
    UserContacto: { type: String,  trim: true },
    // Third-party kind (terceros-customers-providers). Immutable after creation
    // (enforced in customerService.update). Legacy docs without the field are
    // treated as customers until backfill-customer-kind runs.
    kind: { type: String, enum: ['customer', 'provider'], default: 'customer' },
    correousados: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
    },
      tenantId: { type: String, required: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'customers'
});

// Indexes
CustomerSchema.index({ isDeleted: 1 });
CustomerSchema.index({ createdAt: -1 });
// Indexes (tenant-aware)
CustomerSchema.index({ tenantId: 1, isDeleted: 1 });
CustomerSchema.index({ tenantId: 1, createdAt: -1 });
CustomerSchema.index({ tenantId: 1, kind: 1, isDeleted: 1 });

// Exclude sensitive fields
CustomerSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
CustomerSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const Customer = model('Customer', CustomerSchema);
