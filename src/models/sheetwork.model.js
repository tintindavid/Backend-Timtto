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
  estado: { type: String, enum: ['Borrador', 'EnviadaAFirmar', 'Firmada'], default: 'Borrador' },
  reports: [
    { type: Schema.Types.ObjectId, ref: 'Report' }
  ],

  /* Client-portal signature (change B). `source` distinguishes HTs generated
     from the field flow vs. the public client-portal sign endpoint (design
     D9/D14). `clientSignature` is optional and undefined on field HTs. */
  source: { type: String, enum: ['field', 'client-portal'], default: 'field' },
  clientSignature: {
    ip: { type: String, trim: true, default: null },
    userAgent: { type: String, trim: true, default: null },
    contentHash: { type: String, trim: true, default: null },
    signedAt: { type: Date, default: null },
    signedBatchId: { type: String, trim: true, default: null },
    tokenId: { type: Schema.Types.ObjectId, ref: 'ClientAccessToken', default: null },
  },
  pdfStatus: { type: String, enum: ['pending', 'ready', 'error'], default: 'ready' }, // default 'ready' for retrocompat with existing sheets
  pdfGenerationError: { type: String, default: null },

  /* Remote sign request (sheetwork-remote-signature spec). Present only on
     sheets created via `POST /api/v1/sheetwork/remote-sign-request`; absent
     on sheets created through the on-site flow. `tokenId` refs the live
     SheetWorkSignToken (one per sheet, unique). */
  remoteSignRequest: {
    tokenId: { type: Schema.Types.ObjectId, ref: 'SheetWorkSignToken', default: null },
    email: { type: String, trim: true, lowercase: true, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    requestedAt: { type: Date, default: null },
    message: { type: String, trim: true, default: null },
    resendCount: { type: Number, default: 0 },
  },

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
SheetWorkSchema.index(
  { tenantId: 1, 'clientSignature.signedBatchId': 1 },
  { partialFilterExpression: { 'clientSignature.signedBatchId': { $exists: true } } }
);
SheetWorkSchema.index(
  { tenantId: 1, 'clientSignature.tokenId': 1 },
  { partialFilterExpression: { 'clientSignature.tokenId': { $exists: true } } }
);
SheetWorkSchema.index(
  { tenantId: 1, 'remoteSignRequest.tokenId': 1 },
  { partialFilterExpression: { 'remoteSignRequest.tokenId': { $exists: true } } }
);

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
