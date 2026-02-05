import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const AddressSchema = new Schema({
  tenantId: { type: String, required: true },
  addressId: { type: String,  trim: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, {
  timestamps: true,
  collection: 'addresss'
});

// Indexes (tenant-aware)
AddressSchema.index({ tenantId: 1, isDeleted: 1 });
AddressSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
AddressSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
AddressSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const Address = model('Address', AddressSchema);
