import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const TenantSchema = new Schema(
  {
    tenantId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    slogan:{type:String, trim:true, default:null},
    direccion: { type: String, trim: true, default: null },
    email: { type: String, trim: true, default: null },
    ciudad: { type: String, trim: true, default: null },
    telefono: { type: String, trim: true, default: null },
    departamento: { type: String, trim: true, default: null },
    pais: { type: String, trim: true, default: null },
    nit: { type: String, trim: true, default: null },
    website: { type: String, trim: true, default: null },
    logoUrl: { type: String, trim: true, default: null },
    status: { type: String, enum: ['active', 'suspended', 'closed'], default: 'active' },
    plan: { type: String, trim: true, default: 'free' },
    ownerId: { type: String, trim: true, default: null },
    settings: { type: Schema.Types.Mixed, default: {} },
    // Soft delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // Use the existing collection name present in the database (singular 'tenant')
    collection: 'tenants',
  }
);

// Indexes
TenantSchema.index({ isDeleted: 1 });
TenantSchema.index({ createdAt: -1 });

TenantSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

TenantSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: false });
  next();
});

export const Tenant = model('Tenant', TenantSchema);
