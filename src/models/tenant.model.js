import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const TenantSchema = new Schema(
  {
    tenantId: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
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
    // Capability ceiling of the whole tenant (change: tenant-capabilities-hybrid-mode). The tenant
    // "type" (provider | client | hybrid) is derived from these flags and never stored. A document
    // without the field is read as the defaults (see normalizeCapabilities); at least one flag
    // must be true (validator on registersExternal).
    capabilities: {
      executesServices: { type: Boolean, default: true },
      registersExternal: {
        type: Boolean,
        default: false,
        // At least one capability must stay enabled.
        validate: {
          validator(value) {
            const executes = this.capabilities ? this.capabilities.executesServices : true;
            return value === true || executes !== false;
          },
          message: 'Al menos una capacidad debe estar habilitada',
        },
      },
    },
    // The single client of a tenant that does not execute services ("Mi información").
    organizationCustomerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
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

// Default: exclude soft-deleted documents.
// Opt out via .setOptions({ includeDeleted: true }) for platform / superadmin queries.
TenantSchema.pre(/^find/, function (next) {
  const opts = this.getOptions ? this.getOptions() : {};
  if (!opts.includeDeleted) this.where({ isDeleted: false });
  next();
});

export const Tenant = model('Tenant', TenantSchema);
