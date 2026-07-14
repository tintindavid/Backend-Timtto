'use strict';

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const roleSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: null },
    permissions: { type: [String], required: true, default: [] },
    isDefault: { type: Boolean, default: false },
    // System roles (isSystem=true) are seeded automatically for each tenant
    // (currently: "Admin"). The service layer blocks delete/rename on them so
    // the tenant cannot lock itself out of the Roles UI.
    isSystem: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'roles',
  }
);

roleSchema.index({ tenantId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
roleSchema.index({ tenantId: 1, isDeleted: 1 });
roleSchema.index({ tenantId: 1, createdAt: -1 });

roleSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    delete ret.isDeleted;
    delete ret.deletedAt;
    return ret;
  },
});

roleSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: false });
  next();
});

export const Role = model('Role', roleSchema);