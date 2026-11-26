import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Short-lived mutex per (tenant, resource) used by demo accounts to keep their limits under concurrent requests.
 * Documented exception to soft delete: a lock is ephemeral, it is removed physically (and expires by TTL).
 */
const DemoLockSchema = new Schema({
  tenantId: { type: String, required: true },
  resource: { type: String, required: true },
  owner: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: 'demo-locks' });

DemoLockSchema.index({ tenantId: 1, resource: 1 }, { unique: true });
DemoLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DemoLock = model('DemoLock', DemoLockSchema);
