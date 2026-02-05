import mongoose from 'mongoose';
import autopopulate from 'mongoose-autopopulate';

const { Schema, model } = mongoose;

const ProtocoloMttoSchema = new Schema({
  tenantId: { type: String, required: true },
    Descripcion: { type: String,  trim: true },
    nombre: { type: String,  trim: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  actividadesMtto: [
    { 
      type: Schema.Types.ObjectId, 
      ref: 'ActividadMtto',
      autopopulate: true,
    }
  ],
}, {
  timestamps: true,
  collection: 'protocolo-mttos'
});



// Indexes (tenant-aware)
ProtocoloMttoSchema.index({ tenantId: 1, isDeleted: 1 });
ProtocoloMttoSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
ProtocoloMttoSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
ProtocoloMttoSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

// Plugins SIEMPRE antes del model
ProtocoloMttoSchema.plugin(autopopulate);

export const ProtocoloMtto = model('ProtocoloMtto', ProtocoloMttoSchema);
