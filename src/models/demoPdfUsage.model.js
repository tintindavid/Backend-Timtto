import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/** Downloads used by a demo account per document (sheet, report, OT of the by-OT report or reports ZIP of a sheet). */
const DemoPdfUsageSchema = new Schema({
  tenantId: { type: String, required: true },
  docType: { type: String, required: true, enum: ['sheetwork', 'report', 'informeOt', 'reportsZip', 'otReports'] },
  docId: { type: String, required: true },
  used: { type: Number, default: 0, min: 0 },
  /** Only for `otReports`: the reports of the work order (`docId`) that can be downloaded. */
  reportIds: { type: [String], default: undefined },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true, collection: 'demo-pdf-usage' });

DemoPdfUsageSchema.index({ tenantId: 1, docType: 1, docId: 1 }, { unique: true });

export const DemoPdfUsage = model('DemoPdfUsage', DemoPdfUsageSchema);
