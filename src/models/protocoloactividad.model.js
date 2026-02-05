import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ProtocoloActividadSchema = new Schema({
    ActividadId: { type: Schema.Types.ObjectId, ref: 'Actividad', trim: true },
    ProtocoloId: { type: Schema.Types.ObjectId, ref: 'ProtocoloMtto', trim: true },
  // Soft delete & audit
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
    tenantId: { type: String, required: true },
}, {
  timestamps: true,
  collection: 'protocolo-actividads'
});

// Indexes
ProtocoloActividadSchema.index({ tenantId: 1, isDeleted: 1 });
ProtocoloActividadSchema.index({ tenantId: 1, createdAt: -1 });

// Exclude sensitive fields
ProtocoloActividadSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  }
});

// Default exclude soft-deleted
ProtocoloActividadSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

export const ProtocoloActividad = model('ProtocoloActividad', ProtocoloActividadSchema);
